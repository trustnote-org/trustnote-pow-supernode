# RPC

### getinfo

return

```
{
  last_mci: {Integer}, 
  last_stable_mci: {Integer},
  count_unhandled: {Integer} 
}
 ```
 
### getnewaddress

return

```
{String} address
```

### getalladdress

return

```
{String} address
```

### checkAddress

param

```
{String} address
```

return

```
{String} ok/invalid address
```

### getBalance

param

```
{String} address
```

return

```
{
  "base":{
    "stable":{Integer},
    "pending":{Integer}
  }
}
```

### getmainbalance

return

```
{
  "base":{
    "stable":{Integer},
    "pending":{Integer}
  }
}
```

### listtransactions

param

```
{String} address or {since_mci: {Integer}, unit: {String}}
```

return

```
[
  {
    "action":{'invalid','received','sent','moved'},
    "amount":{Integer},
    "my_address":{String},
    "arrPayerAddresses":[{String}],
    "confirmations":{0,1},
    "unit":{String},
    "fee":{Integer},
    "time":{String},
    "level":{Integer},
    "asset":{String}
  }
]
```

### sendtoaddress

param

```
{String} address
{Integer} amount
```

return

```
{String} status
```

### miningStatus

return

```
{String} status
```

### getRoundInfo

return

```
{String} 
```

### unitInfo

param

```
{String} unit
```

return

```
{
  'unit': {String},
  'creation_date': {String},
  'version': {String},
  'alt': {Integer},
  'pow_type': {Integer},
  'round_index': {Integer},
  'last_ball_unit': {String},
  'header_commission': {Integer},
  'payload_commission': {Integer},
  'is_free': {Integer},
  'is_on_main_chain': {Integer},
  'latest_included_mc_index': {Integer},
  'level': {Integer},
  'witnessed_level': {Integer},
  'is_stable': {Integer},
  'sequence': {'good'/'temp-bad'/'final-bad'},
  'best_parent_unit': {String}
}
```

### badJoints

return

```
[
  {
    'joint': {String},
    'unit': {String},
    'json': {String},
    'error': {String},
    'creation_date': {String}
  }
]
```

### unhandleJoints

return

```
[
  {
    'unit': {String},
    'peer': {String},
    'json': {String},
    'creation_date': {String}
  }
]
```