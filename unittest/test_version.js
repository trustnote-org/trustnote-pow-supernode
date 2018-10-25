var version = require('../lib/version.js');

console.log('Unittest : compare version\n==================\n')

var client = '1.18.0';
var server = '1.0.0';

console.log(`${ client } ${ version.compareVersions(client, server) } ${ server }`);
// Right answer:
// 1.18.0 > 1.0.0

client = '2.1.2'
server = '2.4.0'
console.log(`${ client } ${ version.compareVersions(client, server) } ${ server }`);
// Right answer:
// 2.1.2 < 2.4.0

client = '1.18.1'
server = '1.18.1'
console.log(`${ client } ${ version.compareVersions(client, server) } ${ server }`);
// Right answer:
// 1.18.1 == 1.18.1