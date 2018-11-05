require("../start");

var eventBus = require("trustnote-pow-common/base/event_bus");

eventBus.on('headless_wallet_ready', function(){
    var headless = require('../lib/wallet')
    var wallet = require("trustnote-pow-common/wallet/wallet")

    wallet.sendMultiPayment({
        wallet: '4b8fWkZSYYiaVrpvY9fFGF+9XoIhy614twyR3+BM7Zg=',
        arrPayingAddresses: ['FGGWZMAFSSH5GNVRTP73NAW6N2MCTSFY'],
        to_address: 'FGGWZMAFSSH5GNVRTP73NAW6N2MCTSFY',
        amount: 1000,
        change_address:'W3BAX3ECVSEQNMO7BJDMOUUEML4JO5Q3',
        arrSigningDeviceAddresses: '04HQUUY62ARR7SYXI7XOTRSLUKNQEPR56',
        signWithLocalPrivateKey: headless.signWithLocalPrivateKey
    }, function(err, result) {
        console.log(err)
        console.log("*&^*^*(^*(^*&^(^(^(^&*^*^(*&^(" + result);
    })
}) 