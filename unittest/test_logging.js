var logging = require('../lib/logging.js');

console.log('Unittest : logging\n==================\n')

logging.replaceConsoleLog()

console.log('This message will be writen in log.txt')