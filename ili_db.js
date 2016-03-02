(function() {
  var crypto = require('crypto');
  var https = require('https');
  var users = require('./ili_users.js');


  if (process.env.ILI_API_HOST === void 0) {
    throw "ILI API HOST not defined.";
  }

  exports.commit = function (user, samples, callback) {
    try{
      var byname = {};
      for (var i = 0; i < samples.length; ++i)
      {
        var entries = byname[samples[i].name] = byname[samples[i].name] || [];
        entries.push({
          time: samples[i].time,
          value: samples[i].value
        });
      }

      var ili_payload = {
        streams: []
      };
      for (var name in byname)
      {
        ili_payload.streams.push({
          name: name,
          data: byname[name]
        });
      }
      var body = JSON.stringify(ili_payload);

      var now = Math.floor(Date.now()/1000);
      var md5 = crypto.createHash("MD5");
      users.keyFor(user).then(function(iliUser) {
        var hmac = crypto.createHmac("SHA256",iliUser.secret_key);
        md5.update(body);
        hmac.update("POST");
        hmac.update("/api/v2/streams");
        hmac.update(md5.digest('hex'));
        hmac.update(now.toString());
        var sig = hmac.digest('hex');

        var opts = {
          host: process.env.ILI_API_HOST,
          path: '/api/v2/streams',
          method: 'POST',
          headers: {
            'Unix-time': now,
            'User-key': user,
            'User-token': sig,
          },
          rejectUnauthorized: false
        };
        var req = https.request (opts, function(resp) {
          if (resp.statusCode >= 200 && resp.statusCode < 300)
            callback();
          else
            callback('POST failed: ' + resp.statusCode);
        });
        req.write(body);
        req.end();
      }).catch(function(err) {
        callback('exception: ' + err.toString());
      });
    }
    catch(e)
    {
      callback('exception: ' + e.toString());
    }
  };
})();
