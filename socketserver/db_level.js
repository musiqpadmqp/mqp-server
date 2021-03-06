'use strict';
// Modules
var levelup = require('levelup'),
leveldown = require('leveldown');
const path = require('path');
const util = require('util');
const fs = require('fs');
const log = new(require('basic-logger'))({
    showTimestamp: true,
    prefix: 'LevelDB'
});
const nconf = require('nconf');

// Files
const Mailer = require('./mail/mailer');
const DBUtils = require('./utils').db;
const User = require('./user');

// Variables
let currentPID = 0;
let currentUID = 0;
let currentCID = 0;
const expires = 1000 * 60 * 60 * 24 * nconf.get('loginExpire');
let usernames = [];

function setupDB(dir, setup, callback) {
  setup = setup || function () {};
  callback = callback || function () {};

  return levelup(leveldown(dir), null, (err, newdb) => {
    if (err) {
      log.error('Could not open db');
      callback(err);
      return;
    }

    newdb.get('setup', (err) => {
      if (err && err.notFound) {
        newdb.put('setup', 1);
        setup(newdb);
        callback(null, newdb);
      } else {
        callback(null, newdb);
      }
    });
  });
}

function setupDB(dir, setup, callback) {
  setup = setup || function () {};
  callback = callback || function () {};

  return levelup(leveldown(dir, null, (err, newdb) => {
    if (err) {
      log.error('Could not open db');
      callback(err);
      return;
    }

    newdb.get('setup', (err) => {
      if (err && err.notFound) {
        newdb.put('setup', 1);
        setup(newdb);
        callback(null, newdb);
      } else {
        callback(null, newdb);
      }
    });
  }));
}

function LevelDB(callback) {
    const dbdir = path.resolve(nconf.get('db:dbDir') || './socketserver/db');
    try {
      fs.statSync(dbdir);
    } catch (e) {
      fs.mkdirSync(dbdir);
    }
    // PlaylistDB
    if (!this.PlaylistDB) {
      this.PlaylistDB = setupDB(`${dbdir}/playlists`,
      // If new DB is created
      (newdb) => {
        currentPID = 1;
        log.debug('PIDCOUNTER set to 1');
        newdb.put('PIDCOUNTER', 1);
      },

      // Callback
      (err, db) => {
        if (err) log.error(`Could not open PlaylistDB: ${err}`);
        if (currentPID !== 0) return;
        db.get('PIDCOUNTER', (err, val) => {
          if (err) {
            throw new Error('Cannot get PIDCOUNTER from UserDB.  Might be corrupt');
          }
          currentPID = parseInt(val, 10);
        });
      });
    }

    // RoomDB
    if (!this.RoomDB) {
      this.RoomDB = setupDB(`${dbdir}/room`,
      // If new DB is created
      () => {},

      // Callback
      (err, db) => {
        if (err) throw new Error(`Could not open RoomDB: ${err}`);
        if (callback) callback(null, db);
      });
    }
    
    // UserDB
    if (!this.UserDB)
        this.UserDB = setupDB(`${dbdir}/users`,

            // If new DB is created
            function (newdb) {
                currentUID = 1;
                log.debug('UIDCOUNTER set to 1');
                newdb.put('UIDCOUNTER', 1);
            },

            // Callback
            function (err, newdb) {
                if (err) {
                    throw new Error('Could not open UserDB: ' + err);
                }
                if (currentUID != 0) return;

                newdb.get('UIDCOUNTER', function (err, val) {
                    if (err) {
                        throw new Error('Cannot get UIDCOUNTER from UserDB. Might be corrupt');
                    }
                    currentUID = parseInt(val);
                });

                newdb.createReadStream()
                    .on('data', function (data) {
                        if (data.key.indexOf('@') == -1) return;
                        try {
                            var user = JSON.parse(data.value);
                        } catch (e) {
                            return;
                        }

                        addUsername(user.un);
                        user.lastdj = false;
                        newdb.put(data.key, JSON.stringify(user));
                    })
                    .on('end', function () {
                        return false;
                    });
            });

    // ChatDB
    if (!this.ChatDB)
        this.ChatDB = setupDB(dbdir + '/chat',

            // If new DB is created
            function (newdb) {
                currentCID = 1;
                log.debug('CIDCOUNTER set to 1');
                newdb.put('CIDCOUNTER', 1);
            },

            // Callback
            function (err, newdb) {
                if (err) {
                    throw new Error('Could not open ChatDB: ' + err);
                }
                if (currentCID != 0) return;

                newdb.get('CIDCOUNTER', function (err, val) {
                    if (err) {
                        throw new Error('Cannot get CIDCOUNTER from PmDB. Might be corrupt');
                    }
                    currentCID = parseInt(val);
                });
            });
    // PmDB
    if (!this.PmDB)
        this.PmDB = setupDB(dbdir + '/pm',

            // If new DB is created
            function (newdb) {},

            // Callback
            function (err, newdb) {
                if (err) {
                    throw new Error('Could not open PmDB: ' + err);
                }
            });

    // IpDB
    if (!this.IpDB)
        this.IpDB = setupDB(dbdir + '/ip',

            // If new DB is created
            function (newdb) {},

            // Callback
            function (err, newdb) {
                if (err) {
                    throw new Error('Could not open IpDB: ' + err);
                }
            });
}


/**
 * getJSON() gives the callback function a parsed JSON object
 * based on the key given.
 *
 * @param {String} key
 * @param {Function} callback
 * @return {Object} this
 */
LevelDB.prototype.getJSON = function (db, key, callback) {
    callback = callback || function () {};

    db.get(key, function (err, val) {
        if (val) {
            try {
                val = JSON.parse(val);
            } catch (e) {
                console.log('Database key ' + key + ' returned malformed JSON object');
                val = null;
            }
        }

        if (callback) callback(err, val);
    });
};

/**
 * putJSON() puts a stringified object into the database at key
 *
 * @param {String} key
 * @param {Object} val
 * @param {Function} callback
 * @return {Object} this
 */
LevelDB.prototype.putJSON = function (db, key, val, callback) {
    callback = callback || function () {};
    db.put(key, JSON.stringify(val), callback);
    return this;
};

// PlaylistDB
LevelDB.prototype.getPlaylist = function (pid, callback) {
    var Playlist = require('./playlist');

    this.getJSON(this.PlaylistDB, pid, function (err, data) {
        if (err) {
            callback('PlaylistNotFound');
            return;
        }

        var pl = new Playlist();
        pl.id = pid;
        util._extend(pl.data, data);

        callback(err, pl);
    });

    return this;
};

LevelDB.prototype.createPlaylist = function (owner, name, callback) {
    var Playlist = require('./playlist');

    var pl = new Playlist();
    pl.id = currentPID++;
    this.PlaylistDB.put('PIDCOUNTER', currentPID);
    pl.data.created = Date.now();
    pl.data.owner = owner;
    pl.data.name = name.substr(0, 100);

    this.putJSON(this.PlaylistDB, pl.id, pl.makeDbObj());
    callback(null, pl);
};

LevelDB.prototype.deletePlaylist = function (pid, callback) {
    this.PlaylistDB.del(pid.toString(), callback);
};

LevelDB.prototype.putPlaylist = function (pid, data, callback) {
    this.putJSON(this.PlaylistDB, pid, data, callback);
};

// RoomDB
LevelDB.prototype.getRoom = function (slug, callback) {
    this.getJSON(this.RoomDB, slug, callback);
    return this;
};

LevelDB.prototype.setRoom = function (slug, val, callback) {
    this.putJSON(this.RoomDB, slug, val, callback);
    return this;
};

// UserDB
function addUsername(un) {
    usernames.push(un.toLowerCase());
}

function removeUsername(un) {
    var ind;
    if ((ind = usernameExists(un)) !== false) usernames.splice(ind, 1);
}

function usernameExists(un) {
    un = un.toLowerCase();

    var ind;
    return ((ind = usernames.indexOf(un)) != -1 ? ind : false);
}

LevelDB.prototype.createUser = function (obj, callback) {
    var that = this;

    var defaultCreateObj = {
        email: null,
        un: null,
        pw: null
    };
    util._extend(defaultCreateObj, obj);

    var inData = defaultCreateObj;
    inData.email = inData.email.toLowerCase();

    // Validation
    if (!inData.email || !DBUtils.validateEmail(inData.email)) {
        callback('InvalidEmail');
        return;
    }
    if (!inData.un || !DBUtils.validateUsername(inData.un)) {
        callback('InvalidUsername');
        return;
    }
    if (usernameExists(inData.un) !== false) {
        callback('UsernameExists');
        return;
    }

    // Check for existing account
    this.userEmailExists(inData.email, function (err, res) {
        if (!err) {
            if (callback) callback('AccountExists');
            return;
        }

        var user = new User();

        user.data.uid = currentUID++;
        that.UserDB.put('UIDCOUNTER', currentUID);
        user.data.un = inData.un;
        user.data.pw = inData.pw;
        user.data.created = Date.now();
        if (nconf.get('room:mail:confirmation')) user.data.confirmation = DBUtils.randomBytes(18, 'base64');
        var updatedUserObj = user.makeDbObj();

        that.putJSON(that.UserDB, inData.email, updatedUserObj, function (err) {
            if (err) {
                callback(err);
                return;
            }

            // Send confirmation email
            if (nconf.get('room:mail:confirmation')) {
                Mailer.sendEmail('signup', {
                    code: user.data.confirmation,
                    user: inData.un,
                }, inData.email, function (data) {
                    console.log(data);
                });
            }

            // Do other ~messy~ stuff
            addUsername(inData.un);
            user.login(inData.email);
            callback(null, user, inData.email);
        });
    });
};

LevelDB.prototype.loginUser = function (email, callback) {
	if (email) {
		email = email.toLowerCase();
		this.getJSON(this.UserDB, email, (err, data) => {
			if ((err && err.notFound) || data == null) {
				callback('UserNotFound');
				return;
			}
			if (err) {
				callback(err);
				return;
			}
			const user = new User();
			user.login(email, data, () => {
				callback(null, user, email);
			});
		});
	}
};

LevelDB.prototype.putUser = function (email, data, callback) {
    this.putJSON(this.UserDB, email, data, callback);
};

LevelDB.prototype.getUser = function (email, callback) {
	this.getJSON(this.UserDB, email, function (err, data) {
		if ((err && err.notFound) || data == null) { callback('UserNotFound'); return; }

		if (err) { callback(err); return; }
		var user = new User();

		user.login(email, data, function () {
			callback(null, user);
		});
	});
};

LevelDB.prototype.deleteUser = function (email, callback) {
    var that = this;

	this.getUser(email, function (err, user) {
		if (err) { if (callback) callback(err); return; }

        that.UserDB.del(email);

		callback(null, true);
	});
};

LevelDB.prototype.getUserByUid = function (uid, opts, callback) {
    var done = false;

    if (typeof opts === 'function') {
        callback = opts;
        opts = {};
    }

    if (typeof uid === 'string') {
        uid = parseInt(uid);

        if (isNaN(uid)) {
            callback('UidNotANumber');
            return;
        }
    }

    var isArray = Array.isArray(uid);
    var out = {};
    var len = 0;

    var stream = this.UserDB.createReadStream()
        .on('data', function (data) {
            var obj = {};

            try {
                obj = JSON.parse(data.value);
            } catch (e) {
                return;
            }

            if (isArray) {
                if (uid.indexOf(obj.uid) > -1) {
                    var user = new User();

                    user.login(data.key, obj, opts, function () {
                        out[obj.uid] = user;
                        len++;

                        if (len == uid.length) {
                            done = true;
                            stream.destroy();
                            callback(null, out);
                        }
                    });
                }
            } else {
                if (obj.uid == uid) {
                    done = true;
                    stream.destroy();
                    var user = new User();

                    user.login(data.key, obj, opts, function () {
                        callback(null, user);
                    });
                }
            }
        })
        .on('end', function () {
            if (!done) {
                if (typeof uid === 'number') {
                    callback('UserNotFound');
                } else if (isArray) {
                    console.log('ACTUAL:' + len + '; EXPECTED: ' + uid.length);
                    callback('SomeUsersNotFound', out);
                }
            }
        });
};

LevelDB.prototype.getUserByName = function (name, opts, callback) {
    var done = false;

    if (typeof opts === 'function') {
        callback = opts;
        opts = {};
    }

    var stream = this.UserDB.createReadStream()
        .on('data', function (data) {
            var obj = {};

            try {
                obj = JSON.parse(data.value);
            } catch (e) {
                return;
            }

            if (obj.un && obj.un.toLowerCase() == name.toString().toLowerCase()) {
                done = true;

                stream.destroy();
                var user = new User();

                user.login(data.key, obj, opts, function () {
                    if (callback) callback(null, user);
                });
            }
        })
        .on('end', function () {
            if (!done && callback)
                callback('UserNotFound');
        });
};

LevelDB.prototype.userEmailExists = function (key, callback) {
    this.getJSON(this.UserDB, key, function (err, data) {
        if (err && err.notFound) {
            if (callback) callback(err, false);
            return;
        }

        if (callback) callback(err, true);
    });
};

// ChatDB
LevelDB.prototype.logChat = function (uid, msg, special, callback) {
    this.putJSON(this.ChatDB, currentCID, { uid, msg, special });
    callback(null, currentCID++);
};

// PmDB
LevelDB.prototype.logPM = function (from, to, msg, callback) {
    var that = this;
    var key = Math.min(from, to) + ':' + Math.max(from, to);

    this.getJSON(this.PmDB, key, function (err, res) {
        var out = [];

        if (!err) out = res;

        out.push({
            message: msg,
            time: new Date(),
            from,
            unread: true,
        });

        that.putJSON(that.PmDB, key, out);
    });
};

LevelDB.prototype.getConversation = function (from, to, callback) {
    var key = Math.min(from, to) + ':' + Math.max(from, to);

    this.getJSON(this.PmDB, key, function (err, res) {
        if (err) {
            callback(null, []);
        } else {
            callback(null, res);
        }
    });
};

LevelDB.prototype.getConversations = function (uid, callback) {
    var that = this;

    var out = {};
    var uids;
    uid = uid.toString();

    this.PmDB.createReadStream()
        .on('data', function (data) {
	    data.key = data.key.toString();
            if (data.key.indexOf(':') == -1 || (uids = data.key.split(':')).indexOf(uid) == -1) return;

            try {
                var convo = JSON.parse(data.value);
            } catch (e) {
                return;
            }

            var unread = 0;
            convo.map(function (e) {
                if (e.unread && e.from != uid) unread++;
                return {
                    messages: e.messages,
                    time: e.time,
                    from: e.from,
                };
            });

            out[uids[(uids.indexOf(uid) + 1) % 2]] = {
                user: null,
                messages: [convo.pop()],
                unread,
            };
        })
        .on('end', function () {
            var uids = Object.keys(out).map(function (e) { return parseInt(e); });

            if (uids.length > 0) {
                that.getUserByUid(uids, function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        for (var id in result) {
                            out[id].user = result[id].getClientObj();
                        }
                        callback(null, out);
                    }
                });
            } else {
                callback(null, out);
            }
            return false;
        });
};

LevelDB.prototype.markConversationRead = function (uid, uid2, time) {
    var that = this;
    var key = Math.min(uid, uid2) + ':' + Math.max(uid, uid2);

    this.getJSON(this.PmDB, key, function (err, res) {
        if (err) return;

        res.map(function (e) {
            if (e.from == uid2 && new Date(e.time) < new Date(time)) e.unread = false;
            return e;
        });

        that.putJSON(that.PmDB, key, res);
    });
};

// IpDB
LevelDB.prototype.logIp = function (address, uid) {
    let that = this;

    this.getJSON(this.IpDB, uid, function (err, res) {
        let out = res || [];

        out.push({
            address,
            time: new Date(),
        });

        that.putJSON(that.IpDB, uid, out);
    });
};

LevelDB.prototype.getIpHistory = function (uid, callback) {
    this.getJSON(this.IpDB, uid, (err, data) => {
        if (err) {
          callback(err);
        }
        else {
          callback(null, data.sort(function (a, b) { return a.address > b.address; }).reverse().filter(function (e, i, a) { return i == 0 || a[i - 1].address != e.address; }).sort(function (a, b) { return a.time < b.time; }));
        }
    });
};

module.exports = LevelDB;
