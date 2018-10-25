require('../start.js');
var eventBus = require('trustnote-pow-common/base/event_bus');

console.log('Unittest : create miner deposit address\n==================\n')

eventBus.on('headless_wallet_ready', function(){
    var createMinerDepositAddress = require('../lib/create_deposit_address.js');
    var db = require('trustnote-pow-common/db/db.js');

    db.query('SELECT * from my_addresses', [], function(rows) {
        var my_addresses = rows[0].address;
        createMinerDepositAddress.createMinerDepositAddress(my_addresses, 1000, function(shared_address){
            console.log(JSON.stringify(shared_address));
        })
    })
})