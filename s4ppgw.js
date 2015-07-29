net = require('net');
crypto = require('crypto');
users = require('./users.js');
db = require('./db.js');
fs = require('fs');

var valid_algos = ['MD5', 'SHA1', 'SHA256', 'SHA384', 'SHA512'];
var idle_timeout_sec = 10;

function disable_idle_timeout(sock)
{
  if (sock.timer)
    clearTimeout (sock.timer);
}

function refresh_idle_timeout(sock)
{
  disable_idle_timeout(sock);
  sock.timer = setTimeout(function () {
    console.info('connection timeout');
    sock.end('REJ:timeout\n');
    sock.destroy();
    }, idle_timeout_sec * 1000);
}

function maybe_tap_data(samples)
{
  if (process.argv.length > 2)
  {
    var lines = "";
    for (var i = 0; i < samples.length; ++i)
    {
      var line = samples[i].time + ',' + samples[i].value + ',' + samples[i].name + '\n';
      lines += line;
    }
    var fname = process.argv[2];
    fs.appendFileSync(fname, lines);
  }
}

function s4pp_updatehash(sock, line)
{
  sock.hmac.update (line);
  sock.hmac.update ('\n');
}

function s4pp_fail(sock, msg)
{
  sock.end('REJ:'+msg+'\n');
  disable_idle_timeout(sock);
  sock.destroy();
}

function s4pp_auth(sock, line)
{
  sock.runhash = false;
  if (sock.expect.indexOf('auth') < 0)
  {
    s4pp_fail(sock, "unexpected auth");
    return;
  }

  var arr = line.split(',');
  if (arr.length != 3)
  {
    s4pp_fail(sock, "bad auth");
    console.info('AUTH: malformed: ', line);
    return;
  }
  var algo = arr[0];
  if (valid_algos.indexOf(algo) < 0)
  {
    s4pp_fail(sock, "bad auth");
    console.info('AUTH: unsupported algo:',algo);
    return;
  }
  sock.algo = algo;
  var user = arr[1];
  var sig = arr[2];
  sock.key = users.keyFor(user);

  if (!sock.key)
  {
    s4pp_fail(sock, "bad auth");
    console.info('AUTH: no key for user:', user);
    return;
  }

  var hmac = crypto.createHmac(sock.algo, sock.key);
  hmac.update(user);
  hmac.update(sock.token);
  var auth = hmac.digest('hex');
  if (auth != sig)
  {
    s4pp_fail(sock, "bad auth");
    console.info('AUTH: failed for user:', user, 'expected', auth, 'got', sig);
    return;
  }

  sock.user = user;
  sock.expect = ['seq'];
  sock.hmac = crypto.createHmac(sock.algo, sock.key);
}

function s4pp_seq(sock, line)
{
  sock.hmac.update(sock.token);
  sock.runhash = true;
  if (sock.expect.indexOf('seq') < 0)
  {
    s4pp_fail(sock, "unexpected seq");
    return;
  }

  var arr = line.split(',');
  if (arr.length != 4)
  {
    s4pp_fail(sock, "bad seq format");
    return;
  }
  var seq = Number(arr[0]);
  if (seq < sock.next_seq)
  {
    s4pp_fail(sock, "bad seq");
    return;
  }
  sock.this_seq = seq;
  sock.next_seq += seq + 1;
  sock.lasttime = Number(arr[1]);
  sock.timediv = Number(arr[2]);
  sock.dataformat = Number(arr[3]);
  if (sock.dataformat != 0)
  {
    s4pp_fail(sock,"dataformat unsupported");
    return;
  }
  sock.expect = ['data', 'sig', 'dict'];
}

function s4pp_dict(sock, line)
{
  sock.runhash = true;
  if (sock.expect.indexOf('dict') < 0)
  {
    s4pp_fail(sock, "unexpected dict");
    return;
  }

  var arr = line.split(',');
  if (arr.length < 4)
  {
    s4pp_fail("bad dict");
    return;
  }
  var idx = Number(arr[0]);
  var unit = arr[1];
  var unitdiv = Number(arr[2]);
  arr.splice(0,3);
  var name = arr.join(','); // undo split
  sock.dict[idx] = {
    unit: unit,
    unitdiv: unitdiv,
    name: name
  };
  sock.expect = ['dict','data','sig'];
}

function s4pp_sig(sock, line)
{
  sock.runhash = false;
  if (sock.expect.indexOf('sig') < 0)
  {
    s4pp_fail(sock, "unexpected sig");
    return;
  }
  var sig = sock.hmac.digest('hex');
  if (sig != line)
  {
    s4pp_fail(sock, "bad sig");
    return;
  }

  var commit_seq = sock.this_seq; // may change before callback
  var commit_cache = sock.cache;
  maybe_tap_data (commit_cache);
  sock.cache = {};
  db.commit (sock.user, commit_cache, function(err) {
    if (err)
    {
      console.warn('DB: failed to commit:', err);
      sock.write('NOK:' + commit_seq + "\n");
    }
    else
      sock.write('OK:' + commit_seq + "\n");
  });

  sock.expect = ['seq'];
  sock.hmac = crypto.createHmac (sock.algo, sock.key);
}

function s4pp_data(sock, line)
{
  if (sock.expect.indexOf('data') < 0)
  {
    s4pp_fail(sock, "unexpected data");
    return;
  }

  var arr = line.split(',');
  if (arr.length != 3)
  {
    s4pp_fail(sock, "bad data");
    return;
  }
  var sensor = sock.dict[arr[0]];
  if (!sensor)
  {
    s4pp_fail(sock, "unknown idx");
    return;
  }
  if (sock.cache.length > sock.max_cache_size)
  {
    s4pp_fail(sock, "cache limit exceeded");
    return;
  }

  var tstamp = sock.lasttime + Number(arr[1]);
  var val = Number(arr[2]) / sensor.unitdiv;
  sock.cache.push({
    name: sensor.name,
    time: Math.floor(tstamp/sock.timediv),
    value: val
  });
  sock.lasttime = tstamp;
  sock.expect = ['data', 'sig', 'dict'];
  sock.runhash = true;
}
  
var commands =
{
  'AUTH:': s4pp_auth,
  'SEQ:' : s4pp_seq,
  'DICT:': s4pp_dict,
  'SIG:' : s4pp_sig
};

function s4pp_begin(sock)
{
  refresh_idle_timeout(sock);
  sock.token = crypto.pseudoRandomBytes(32).toString('hex');
  //sock.token = '879cb65c9f9c5ecb19d2d88ad7ce81ca6f61394078b4477d9232ee70b2c8bd5d';
  sock.max_cache_size = 2000;
  sock.write('S4PP/0.9 '+valid_algos.join(',')+' '+sock.max_cache_size+'\nTOK:'+sock.token+'\n');
  sock.data = '';
  sock.dict = {};
  sock.cache = [];
  sock.next_seq = 0;
  sock.expect = ['auth'];
  sock.runhash = false;
}

function s4pp_run(sock, data)
{
  refresh_idle_timeout(sock);
  sock.data += data
  while ((i = sock.data.indexOf('\n')) != -1)
  {
    line = sock.data.substr(0,i);
    sock.data = sock.data.substr(i+1);
    var wascmd = false;
    for (var cmd in commands)
    {
      if (line.lastIndexOf(cmd, 0) == 0)
      {
        commands[cmd](sock,line.substr(cmd.length));
        wascmd = true;
        break;
      }
    }
    if (!wascmd)
      s4pp_data(sock,line);
    if (sock.runhash)
      s4pp_updatehash(sock, line);
  }
}

net.createServer(function (sock) {
  sock.on('error',function(exc) { console.warn('socket exception: ' + exc); });
  sock.on('data',function(data) { s4pp_run(sock, data); });
  sock.on('close',function() { disable_idle_timeout(sock); });
  s4pp_begin(sock);
}).listen (22226);
console.log('S4PP on port 22226\n');

