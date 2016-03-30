Q  = require('q');

(function() {

  if (process.env.ILI_API_HOST === void 0 || process.env.ILI_USER_SECRET_KEY === void 0 ||
     process.env.ILI_USER_KEY === void 0) {
      throw "ILI environment config not defined.";
  }

  var userCache = {};
  var cacheCreatedAt;

  function cacheAge() {
     return (((new Date() - cacheCreatedAt) / 1000) / 60);
  }

  function populateUserCache() {
    console.log('Populating user cache...');
    userCache._loaded=false;
    getIliUsers(function(err, users) {
      if (err) throw "Unable to get users from ili API: " + err;
      users['users'].map(function(obj) {
        userCache[obj.key] = obj;
      });
      userCache._loaded=true;
      cacheCreatedAt = new Date();
      console.log('Finished populating User cache at: ' + cacheCreatedAt);
    });
  };

  exports.keyFor = function(user) {
    var deferred = Q.defer();
    waitForUsers = function() {
      if (userCache._loaded !== true) {
        return setTimeout(function() {
          return waitForUsers();
        }, 200);
      } else {
        var userObject = userCache[user];
        if (userObject == null && cacheAge() > 60) {
          console.log('User not in cache. Cache has expired.  Repopulating...');
          populateUserCache();
          waitForUsers();
        } else {
          return deferred.resolve(userObject);
        }
      }
    };

    waitForUsers();
    return deferred.promise;
  };

  populateUserCache();

})();

function getIliUsers(cb) {
  var https = require('https');

  var crypto = require('crypto');
  var hmac = crypto.createHmac('sha256', process.env.ILI_USER_SECRET_KEY);
  var date = new Date().toUTCString();
  hmac.update('GET/api/v2/users'+date);
  var userToken = hmac.digest('hex');
  https.get({
    host: process.env.ILI_API_HOST,
    path: '/api/v2/users',
    rejectUnauthorized: false,
    headers: {
      'User-key': process.env.ILI_USER_KEY,
      'User-token': userToken,
      'Date': date,
      'Content-Type': "application/json"
    }
  }, function(res) {
    res.setEncoding('utf8');
    var body = '';
    res.on('data', function(d) {
      body += d;
    });

    res.on('end', function() {
      try {
        var users = JSON.parse(body);
      } catch (err) {
        console.error('Unable to parse response as JSON', err);
        return cb(err);
      }
      cb(null, users);
    });
  }).on('error', function(err) {
    console.error('Error with the request:', err.message);
    cb(err);
  });
}
