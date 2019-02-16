# Token helper
manage subiz access token and refresh token for clients

# Install
```
npm i --save tokenhelper
```

# Usage

## example
# Standalone
```js
const th = require('tokenhelper')
let helper = th.newHelper({tokenep: "https://subiz.com/oauth/"})

// user login => got tokens
token.reset({account_id,agent_id,session,access_token, refreshtoken})

// use the token

var tk = await token.get()
if (tk.error) {
	throw tk.error
}

// ...
apireq.setQuery({access_token: tk.access_token}).send()
// ...


```
