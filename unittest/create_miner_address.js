require('../start.js');
var eventBus = require('trustnote-pow-common/base/event_bus');

eventBus.on('headless_wallet_ready', function(){
    var createMinerAddress = require('../lib/create_miner_shared_address.js');

    createMinerAddress.createMinerSharedAddress('RV5KBMMUBQKG6EKRSKLFOSJOMVBUFOHU', 1000, function(shared_address){
        console.log(JSON.stringify(shared_address));
    })
})