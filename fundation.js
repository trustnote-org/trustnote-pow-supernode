require("./start");
var eventBus = require("trustnote-pow-common/base/event_bus");
var conf = require("trustnote-pow-common/config/conf");

function onError(err) {
    console.log('## ERROR on transfer deposit: ' + err);
}

eventBus.on('headless_wallet_ready', function(){
    setInterval(function() {
        var db = require("trustnote-pow-common/db/db");
        var deposit = require("trustnote-pow-common/sc/deposit")
        var wallet = require("./lib/wallet")
        db.query("SELECT * FROM supernode", [], function(rows) {
            var addresses = rows.map(function(node){return node.address})
            for(address of addresses){
                deposit.hasInvalidUnitsFromHistory(null, address, function(err, hasInvalid){
                    if(hasInvalid) {
                        var composer = require('trustnote-pow-common/unit/composer.js');
                        var network = require('trustnote-pow-common/p2p/network.js');
                        var callbacks = composer.getSavingCallbacks({
                            ifNotEnoughFunds: onError,
                            ifError: onError,
                            ifOk: function(objJoint){
                                network.broadcastJoint(objJoint);
                            }
                        });

                        var from_address = deposit_address;
                        var arrOutputs = [
                            {address: from_address, amount: 0},      // the change
                            {address: conf.safe_address, amount: 0}  // the receiver
                        ];
                        composer.composePaymentJoint(composeJoint({paying_addresses: [from_address], outputs: arrOutputs, signer: wallet.signer, send_all = true,callbacks: callbacks}));
                    }
                })
            }
        })
    }, 5*60*1000)
})