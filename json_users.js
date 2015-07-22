(function() {
  var usertable = require('./userdb.json');

  exports.keyFor = function (user)
  {
    return usertable[user];
  };
})();
