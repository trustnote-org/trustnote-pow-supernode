require('../start.js');
var eventBus = require('trustnote-pow-common/base/event_bus');

console.log('Unittest : create miner deposit address\n==================\n')

eventBus.on('headless_wallet_ready', function(){
    var createMinerDepositAddress = require('../lib/create_deposit_address.js');

    createMinerDepositAddress.createMinerDepositAddress('RV5KBMMUBQKG6EKRSKLFOSJOMVBUFOHU', 1000, function(shared_address){
        console.log(JSON.stringify(shared_address));
    })
})