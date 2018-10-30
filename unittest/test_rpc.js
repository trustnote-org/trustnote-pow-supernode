let rpc = require('json-rpc2');

let ip = 'localhost'

let rpcClient = function(ip, api, params, callback) {
    let client = rpc.Client.$create(6553, ip);
    if(!params) {
        params = []
    }
    client.call(api, params, function(err, result) {
        callback(result)
    })
}

// rpcClient(ip, 'getinfo', null, function(result) {
//     console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }\n`)
//     if(result) {
//         console.log(`IP: ${ ip }, result:
// last_mci ${ result.last_mci },
// last_stable_mci ${ result.last_stable_mci },
// count_unhandled ${ result.count_unhandled }\n`)
//     }
// })

// rpcClient(ip, 'unhandledJoints', null, function(result) {
//     console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }\n`)
//     if(result) {
//         console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }`)
//     }
// })

rpcClient(ip, 'sendpaymentfromdepositaddress', ['W3BAX3ECVSEQNMO7BJDMOUUEML4JO5Q3', 100000000], function(result) {
    console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }\n`)
    if(result) {
        console.log(`IP: ${ ip }, result: ${ JSON.stringify(result) }`)
    }
})