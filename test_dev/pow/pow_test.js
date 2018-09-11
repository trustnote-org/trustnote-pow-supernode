var db = require("trustnote-pow-common/db.js")
var pow = require("trustnote-pow-common/pow.js")
var event_bus = require("trustnote-pow-common/event_bus.js")

db.takeConnectionFromPool(function(conn){
    console.log("=====Get Connection=====")
    var round_index = 1;
    pow.obtainMiningInput(conn, round_index, function(err, input_object) {
        console.log("=====Get Input=====")
        conn.release();
        if (err) {
            // notifyAdminAboutWitnessingProblem(err)
            console.log("Mining Error:" + err);
            bMining = false;
        }
        else {
            console.log("=====Start Mining=====")
            pow.startMiningWithInputs(input_object, function(err){
                if (err) {
                    console.log("Mining Error:" + err);
                } else {
                    console.log("Mining Succeed");
                }
                bMining = false;
                console.log("=====Finished Mining=====")
            })
        }
    })
        
})

event_bus.on
(
	'pow_mined_gift',
	( objSolution ) =>
	{
		console.log( `############################################################` );
		console.log( objSolution );
	}
);