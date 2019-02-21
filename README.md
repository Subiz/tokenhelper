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
let token = th.createHelper({tokenep: "https://subiz.com/oauth/"})

// user login => got tokens
token.reset({account_id, agent_id, access_token, refreshtoken, expires_in})

// use the token

var tk = await token.get()
if (tk.error) {
	throw tk.error
}

// ...
apireq.setQuery({access_token: tk.access_token}).send()
// ...


```
