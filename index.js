
var http = require('http');
var debounce = require('debounce');

var StatsD = require('node-dogstatsd').StatsD;
var dd = new StatsD();
var fixedDelay;

var totalUsers = 30;
var rate = 25; //pre second
fixedDelay = Math.round(1000/rate);

var host = 'localhost';
var port = '3000';
/*
   var host = 'api.instanews.com';
   var port = '80';
   */
var box = {
  //Bottom Left corner
  sw: {
    lat: 45.356309,
    lng: -74.10765
  },
  //TOP Right corner
  ne: {
    lat: 45.726138,
    lng: -73.381780
  }
};

var userCreationTime = totalUsers*500; //ms
//Max interactions per user
var max = 1000;
//Time delay range between user interactions
var minDelay = 1000; //ms
var maxDelay = 2*totalUsers*1000/rate - minDelay; //ms

var options = {
  host: 'api.instanews.com',
  path: '/api/articles'
  //method: 'POST'
}; 

var reqPerSec = 0;
var pendingReq = 0;
var totalRequests = 0;

var print = debounce(function () {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(' Rate: ' + reqPerSec + '\tPending: ' + pendingReq + '\tTotal: ' + totalRequests + '\tDelta: ' + delta);
}, 16);

var last = Date.now();
var delta = 0;
console.log('\n***********************************************\n');
var request = function (options, send, end) {
  var newTime = Date.now();
  delta = newTime - last;
  last = newTime;
  pendingReq++;
  totalRequests++;
  print();
  reqPerSec++;
  setTimeout(function () {
    reqPerSec--;
  }, 1000);

  if (!end) {
    if( send instanceof Function) {
      end = send;
      send = null;
    } else {
      console.error('No Callback was given!');
    }
  }

  dd.histogram('DOS.request.total', totalRequests);
  dd.histogram('DOS.request.pending', pendingReq);
  dd.increment('DOS.request.count');
  dd.timing('DOS.request.delay', delta);

  //Close the connection after the request is complete
  options.agent = false;
  if(!options.headers) {
    options.headers = {};
  }
  options.headers['Connection'] = 'close';

  var req = http.request(options, function (resp) {
    var str = '';

    resp.on('data', function (chunk) {
      str += chunk;
    });

    resp.on('end', function () {
      pendingReq--;
      var res = JSON.parse(str);
      if(res.error) {
        console.dir(res);
      }
      end(res);
    });
  });

  req.on('error', function(e) {
      console.log('problem with request: ' + e.message);
  });

  if(send) {
    //process.stdout.write('Writing: ' + send);
    req.write(send);
  }
  req.end();
};

var randomLocation = function () {
  return {
    lat: Math.random()*(box.ne.lat - box.sw.lat) + box.sw.lat,
    lng: Math.random()*(box.ne.lng - box.sw.lng) + box.sw.lng
  };
};

var getRandomUpVote = function (user) {
  return getRandom(user.upVotes);
};

var getRandomDownVote = function (user) {
  return getRandom(user.downVotes);
};

var getRandom = function(ignore) {
  var getRandomIdx = Math.round(Math.random()*(random.length - 1));
  var item = random[getRandomIdx]();
  var attempts = 0;
  var max = 10;
  while( (item && ignore.indexOf(item.id) > -1) && attempts < max) {
    attempts++;
    item = random[getRandomIdx]();
  }
  if(attempts === max) {
    console.log('Failed to find a random item not on the ignore list');
  } else {
    return item;
  }
};

var Articles = {
  get: function (user) {
    var query = '?filter=%7B%22limit%22:50,%22skip%22:0,%22order%22:%22rating+DESC%22,%22where%22:%7B%22location%22:%7B%22geoWithin%22:%7B%22$box%22:%5B%5B'+ box.sw.lat + ',' + box.sw.lng +'%5D,%5B'+ box.ne.lat + ','+ box.ne.lng +'%5D%5D%7D%7D%7D%7D';
    request({
      host: host,
      port: port,
      headers: {
        "Content-Type": "application/json",
        "Authorization": user.id
      },
      path: '/api/articles' + query
    }, function (res) {
      res.forEach( function (art) {
        Articles.add(art);
      });
    });
  },
  create: function (user) {
    var art = {
      title: randomString(10),
      isPrivate: false,
      location: randomLocation()
    };

    request({
      host: host,
      port: port,
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "Authorization": user.id
      },
      path: '/api/articles'
    }, JSON.stringify(art), function (res) {
      Articles.add(res);
    });
  },
  add: function (art) {
    var old = Articles.find(art);
    if(!old) {
      art.type = 'article';
      Articles.items.push(art);
    }
  },
  find: function (art) {
    Articles.items.forEach(function (item) {
      if(item.id == art.id) {
        return item;
      }
    });
  },
  getRandom: function () {
    var idx = Math.round(Math.random()*(Articles.items.length -1));
    if(idx > -1) {
      return Articles.items[idx];
    }
  },
  items: []
};

var Subarticles = {
  get: function (user) {
    var article = Articles.getRandom();
    if(article) {
      var query = '';

      request({
        host: host,
        port: port,
        headers: {
          "Content-Type": "application/json",
          "Authorization": user.id
        },
        path: '/api/articles/' + article.id + '/subarticles' + query
      }, function (res) {
        res.forEach( function (sub) {
          Subarticles.add(sub);
        });
      });
    }
  },
  create: function (user) {
    var article = Articles.getRandom();
    if(article) {
      var sub = {
        parentId: article.id,
        text: JSON.stringify(article.location) 
      };

      request({
        host: host,
        port: port,
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          "Authorization": user.id
        },
        path: '/api/articles/' + article.id + '/subarticles'
      }, JSON.stringify(sub), function (res) {
        Subarticles.add(res);
      });
    }
  },
  add: function (art) {
    var old = Subarticles.find(art);
    if(!old) {
      art.type = 'subarticle';
      Subarticles.items.push(art);
    }
  },
  find: function (art) {
    Subarticles.items.forEach(function (item) {
      if(item.id == art.id) {
        return item;
      }
    });
  },
  getRandom: function () {
    var idx = Math.round(Math.random()*(Subarticles.items.length -1));
    if(idx > -1) {
      return Subarticles.items[idx];
    }
  },
  items: []
};

var DownVotes = {
  create: function (user) {
    if(!user.downVotes) {
      user.downVotes = [];
    }
    var item = getRandomDownVote(user);
    if(item) {
      user.downVotes.push(item.id);
      var down = {
        clickableId: item.id,
        clickableType: item.type
      };

      request({
        host: host,
        port: port,
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          "Authorization": user.id
        },
        path: '/api/downVotes'
      }, JSON.stringify(down), function (res) {
        //    console.dir(res);
      });
    }
  }
};

var UpVotes = {
  create: function (user) {
    if(!user.upVotes) {
      user.upVotes = [];
    }
    var item = getRandomUpVote(user);
    if(item) {
      user.upVotes.push(item.id);
      var up = {
        clickableId: item.id,
        clickableType: item.type 
      };

      request({
        host: host,
        port: port,
        method: 'POST',
        headers: {
          "Content-Type": "application/json",
          "Authorization": user.id
        },
        path: '/api/upVotes'
      }, JSON.stringify(up), function (res) {
        //      console.dir(res);
      });
    }
  }
};

var get = [
  Articles.get,
  Subarticles.get
];

var random = [
  Articles.getRandom,
  Subarticles.getRandom
];

var post = [
  DownVotes.create,
  UpVotes.create,
  Articles.create,
  Subarticles.create
];

var actions = [get, post];

var users = [];

var run = function (user, count) {
  var timeout;
  if(fixedDelay) {
    timeout = fixedDelay;
  } else {
    timeout = Math.floor(Math.random()*(maxDelay -minDelay) + minDelay);
  }

  if(!user && users.length) {
    user = users[Math.round(Math.random()*(users.length -1))];
  } 
  if(user) {
    var idx = Math.round(Math.random()*(actions.length -1));
    // GET or POST
    var acts = actions[idx];
    // Random method from list
    idx = Math.round(Math.random()*(acts.length -1));
    var action = acts[idx];
    action(user);
  } else {
    console.warn('Invalid user');
  }

  setTimeout(function () {
    if(count < max) {
      if(fixedDelay) {
        run(null, count);
      } else {
        run(user, count);
      }
    }
  }, timeout);
};

var randomString = function (limit) { 
  if(!limit) {
    limit = 40;
  }
  var subs = ['af','in','a','on','ate','ca','ou','th','ro','za','ne','me', 'the', 'of', 'y', 'i', 'e','o', 'u', 'm','n'];
  var str = '';
  for(var  i = 0; i < limit; i++) {
    if(! ((i + 1) % 5)) {
      str += ' ';
    } else {
      var idx = Math.round(Math.random()*(subs.length -1));
      str += subs[idx];
    }
  }
  return str;
};

for(var i = 0 ; i < totalUsers ; i++) {
  var timeout = Math.floor(Math.random()*userCreationTime); // create the users randomly over the next minute
  // 1 users per second
  if(fixedDelay) {
    timeout = 1000*i;
  }

  var count = 0;
  setTimeout(function () {
    count++;
    //console.log(count + ': ' + new Date());
    var username = randomString(4);
    var password = 'password' + i;
    request({
      host: host,
      port: port,
      method: 'POST',
      headers: {"Content-Type": "application/json"},
      //path: '/api/journalists?include=user&rememberMe=true'
      path: '/api/journalists'
    }, JSON.stringify({
      username: username,
      password: 'password' + i,
      email: username + '@instanews.org'
    }), function (res) {
      //console.dir(res);
      request({
        host: host,
        port: port,
        method: 'POST',
        headers: {"Content-Type": "application/json"},
        //path: '/api/journalists/login?include=user&rememberMe=true'
        path: '/api/journalists/login'
      }, JSON.stringify({
        username: username,
        password: password
      }), function (user) {
        if(user.error) {
          //console.log(user);
        } else {
          if(fixedDelay) {
            users.push(user);
          } else {
            run(user, 0);
          }
        }
      });
    });
  }, timeout);
}

if(fixedDelay) {
  run(null, 0);
}
