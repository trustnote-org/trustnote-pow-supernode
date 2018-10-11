let rpc = require('json-rpc2');

let ip_list = [
    'localhost',
    '127.0.0.1',
    '10.10.10.100', //  test-supernode1
    '10.10.10.101', //  test-supernode2
    // '10.10.10.102', //  test-supernode3
    // '10.10.10.103', //  test-supernode4
    // '10.10.10.104', //  test-supernode5
    // '10.10.10.105', //  test-supernode6
    // '10.10.10.106', //  test-supernode7
    // '10.10.10.107', //  test-supernode8
    // '10.10.10.108', //  test-supernode9
    ]

let rpcClient = function(ip, api, params, callback) {
    let client = rpc.Client.$create(6552, ip);
    if(!params) {
        params = []
    }
    client.call(api, params, function(err, result) {
        callback(result)
    })
}

for (let ip of ip_list) {
    rpcClient(ip, 'getinfo', null, function(result) {
        console.log(`IP: ${ ip }, result: ${ result }\n`)
        if(result) {
            console.log(`IP: ${ ip }, result:
last_mci ${ result.last_mci },
last_stable_mci ${ result.last_stable_mci },
count_unhandled ${ result.count_unhandled }\n`)
        }
    })
}