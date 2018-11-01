require("../start");
var eventBus = require("trustnote-pow-common/base/event_bus");
var conf = require("trustnote-pow-common/config/conf");
var objectHash = require('trustnote-pow-common/base/object_hash.js');
var constants = require('trustnote-pow-common/config/constants');

function onError(err) {
    throw Error(err)
}

eventBus.on('headless_wallet_ready', function(){
    var headless = require('../lib/wallet')
    var wallet = require("trustnote-pow-common/wallet/wallet")
    var definition_chash = "W3BAX3ECVSEQNMO7BJDMOUUEML4JO5Q3";

    var composer = require('trustnote-pow-common/unit/composer.js');
    var network = require('trustnote-pow-common/p2p/network.js');
    var callbacks = composer.getSavingCallbacks({
        ifNotEnoughFunds: onError,
        ifError: onError,
        ifOk: function(objJoint){
            network.broadcastJoint(objJoint);
        }
    });

    wallet.sendMultiPayment({
        wallet: '4b8fWkZSYYiaVrpvY9fFGF+9XoIhy614twyR3+BM7Zg=',
        arrPayingAddresses: 'FGGWZMAFSSH5GNVRTP73NAW6N2MCTSFY',
        to_address: 'FGGWZMAFSSH5GNVRTP73NAW6N2MCTSFY',
        amount: 1000,
        change_address:'FGGWZMAFSSH5GNVRTP73NAW6N2MCTSFY',
        arrSigningDeviceAddresses: '04HQUUY62ARR7SYXI7XOTRSLUKNQEPR56',
        signWithLocalPrivateKey: headless.signWithLocalPrivateKey
    }, function(err, result) {
        console.log(err)
        console.log("*&^*^*(^*(^*&^(^(^(^&*^*^(*&^(" + result);
    })
}) 