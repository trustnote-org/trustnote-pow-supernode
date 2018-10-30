let rpc = require('json-rpc2');

let ip = 'localhost'

let rpcClient = function(ip, api, params, callback) {
    let client = rpc.Client.$create(6553, ip);
    if(!params) {
        params = []
    }
    client.call(api, params, function(err, result) {
        if(err) {
            console.log(`IP: ${ ip }, error: ${ JSON.stringify(err) }\n`)
        }
        callback(result)
    })
}

rpcClient(ip, 'getinfo', null, function(result) {
    console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }\n`)
})

rpcClient(ip, 'unhandledJoints', null, function(result) {
    console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }\n`)
})

rpcClient(ip, 'createMinerAddress', [100000], function(result) {
    console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }\n`)
})

// rpcClient(ip, 'sendpaymentfromdepositaddress', ['W3BAX3ECVSEQNMO7BJDMOUUEML4JO5Q3', 100000000], function(result) {
//     console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }\n`)
// })