
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var http = require('http');
var debounce = require('debounce');

var StatsD = require('node-dogstatsd').StatsD;
var dd = new StatsD();

var totalUsers = 64; //Use powers of 2 so that there is an even number on  each core 
var rate = 20; //per second
var randomTiming = true;

/*
var host = '192.168.1.2';
var port = '3000';
*/
var host = 'instanews.com';
var port = '80';

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

var fixedDelay = Math.round(totalUsers*1000/rate);
var userCreationTime = totalUsers*500; //ms
//Max interactions per user
var maxRequests = 1000;
//Time delay range between user interactions
var minDelay = 1000; //ms
var maxDelay = 2*fixedDelay - minDelay; //ms

var options = {
  host: 'api.instanews.com',
  path: '/api/articles'
  //method: 'POST'
}; 

var reqPerSec = 0;
var pendingReq = 0;
var totalReq = 0;
var errors = 0;

var print = debounce(function () {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write('Total: ' + totalReq + '\tErrors: ' + errors + '\tPending: ' + pendingReq + '\tLast Delay: ' + delta);
}, 66);

var last = Date.now();
var delta = 0;

var request = function (options, send, end) {
  var newTime = Date.now();
  delta = newTime - last;
  last = newTime;
  pendingReq++;
  totalReq++;

  if (!end) {
    if( send instanceof Function) {
      end = send;
      send = null;
    } else {
      console.error('No Callback was given!');
    }
  }

  process.send({
    id: cluster.worker.id,
    totalReq: totalReq,
    delta: delta,
    pendingReq: pendingReq
  });

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
      process.send({
        id: cluster.worker.id,
        pendingReq: pendingReq
      });

      var res = JSON.parse(str);
      if(res.error) {
        console.dir(res);
      }
      end(res);
    });
  });

  req.on('error', function(e) {
    //console.log('problem with request: ' + e.message);
    pendingReq--;
    process.send({
      id: cluster.worker.id,
      pendingReq: pendingReq,
      error: true
    });
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

var run = function (user) {
  var rand = Math.random();
  var timeout;
  if(!randomTiming) {
    timeout = fixedDelay;
  } else {
    timeout = rand*(maxDelay -minDelay) + minDelay;
  }

  if(user) {
    var idx = Math.round(rand*(actions.length -1));
    // GET or POST
    var acts = actions[idx];
    // Random method from list
    idx = Math.round(rand*(acts.length -1));
    var action = acts[idx];
    action(user);
  } else {
    console.warn('Invalid user');
  }

  setTimeout(function () {
    if(totalReq < maxRequests) {
      run(user);
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

if(cluster.isMaster) {
//  console.log('Starting ' + totalUsers + ' processes');
  console.log('Sending requests to ' + host + ':'+ port);

  console.log('Running at rate of ' + rate + ' requests per second using ' + totalUsers + ' users');

  console.log('\n***********************************************\n');
  var workers = [];
  var startNode = function (count) {
    count--
      var worker = cluster.fork();
      worker.pendingReq = 0;
      worker.totalReq = 0;
      workers.push(worker);
      if(count) {
        setTimeout(function () {
          startNode(count);
        }, 1000);
      }
  };
  startNode(totalUsers);

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });

  cluster.on('message', function (msg) {
    if(msg instanceof Object) {
      for(var i in workers) {
        if(workers[i].id === msg.id) {
          if(msg.totalReq !== undefined) {
            totalReq -= workers[i].totalReq;
            workers[i].totalReq = msg.totalReq;
            totalReq += workers[i].totalReq;
            dd.histogram('DOS.request.total', totalReq);
            dd.increment('DOS.request.count');
          }

          if(msg.pendingReq !== undefined) {
            pendingReq -= workers[i].pendingReq;
            workers[i].pendingReq = msg.pendingReq;
            pendingReq += workers[i].pendingReq;
            dd.histogram('DOS.request.pending', pendingReq);
          }

          if(msg.delta !== undefined) {
            delta = msg.delta/workers.length;
            dd.timing('DOS.request.delay', delta);
          }

          if(msg.error) {
            errors++;
            dd.increment('DOS.request.error');
          }
        }
      }

      print();
      // This might be resulting in build up of timeout functions
      /*
      reqPerSec++;
      setTimeout(function () {
        reqPerSec--;
      }, 1000);
     */
    }
  });
} else {
  // Create a user and sign them in
  var username = randomString(4);
  var password = 'password';
  request({
    host: host,
    port: port,
    method: 'POST',
    headers: {"Content-Type": "application/json"},
    path: '/api/journalists'
  }, JSON.stringify({
    username: username,
    password: password,
    email: username + '@instanews.org'
  }), function (res) {
    request({
      host: host,
      port: port,
      method: 'POST',
      headers: {"Content-Type": "application/json"},
      path: '/api/journalists/login'
    }, JSON.stringify({
      username: username,
      password: password
    }), function (usr) {
      if(usr.error) {
        console.error(usr);
      } else {
        //Save the user and begin execution
        run(usr);
      }
    });
  });
}
