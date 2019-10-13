// eslint-disable-next-line
'use strict';
// NCONF
const nconf = require('nconf');
const fs = require('fs-extra');
const hjson = require('hjson');
const crypto = require('crypto');

const hjsonWrapper = {
  parse: (text) => hjson.parse(text, { keepWsc: true, }),
  stringify: (text) => hjson.stringify(text, { keepWsc: true, quotes: 'always', bracesSameLine: true }),
};
if (!fileExistsSync('config.hjson')) {
  fs.copySync('config.example.hjson', 'config.hjson');
}
nconf.file({ file: 'config.hjson', format: hjsonWrapper }).argv().env();

if (!nconf.get('tokenSecret')) {
	const random = crypto.randomBytes(256);
	nconf.set('tokenSecret', random.toString('hex'));
	nconf.save();
}

// Modules
const SocketServer = require('./socketserver/socketserver');
const path = require('path');
const webserver = require('./webserver/app');
const log = new(require('basic-logger'))({
  showTimestamp: true,
  prefix: 'SocketServer',
});
let server;

const webConfig = `// THIS IS AN AUTOMATICALLY GENERATED FILE\n\nvar config=JSON.parse('${JSON.stringify({
  useSSL: nconf.get('useSSL'),
  serverPort: nconf.get('socketServer:port'),
  selfHosted: !0,
  serverHost: nconf.get('socketServer:host')
})}')`;

if (nconf.get('hostWebserver')) {
  fs.writeFileSync(path.join(__dirname, '/webserver/public/lib/js', 'webconfig.js'), webConfig);
  server = (nconf.get('socketServer:port') === nconf.get('webServer:port') || nconf.get('socketServer:port') === '') ? webserver.server : null;
}


fs.writeFileSync(path.join(__dirname, '', 'webconfig.js'), webConfig);

const socketServer = new SocketServer(server);

process.on('uncaughtException', (err) => {
  console.log(err);
  console.log(err.stack);
  socketServer.gracefulExit();
});

process.on('exit', socketServer.gracefulExit);
process.on('SIGINT', socketServer.gracefulExit);
var daemon = "no";
if (daemon = "yes") {
  if (fileExistsSync(`${__dirname}/pidfile`)) {
    try {
      const	pid = fs.readFileSync(`${__dirname}/pidfile`, { encoding: 'utf-8' });
      process.kill(pid, 0);
      process.exit();
    } catch (e) {
      fs.unlinkSync(`${__dirname}/pidfile`);
    }
  }

  fs.writeFile(`${__dirname}/pidfile`, process.pid);
}

function fileExistsSync(path) {
  let exists = false;
  try {
    exists = fs.statSync(path);
  } catch (err) {
    exists = false;
  }
  return !!exists;
}
