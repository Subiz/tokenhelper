var store = require('store')
var gAjax = require('@subiz/ajax/index.js')

function isAccountChange (a, b) {
	return a && b && (a.account_id !== b.account_id || a.agent_id !== b.agent_id)
}

// isGoodToken tells whether a token has not expired or not about to expired
function isGoodToken (created, expireInSec) {
	var endSec = new Date(created).getTime() / 1000
	endSec += expireInSec
	// make token expire 60s sooner than it time
	// since time between client and server cannot perfectly synchronized
	// this reduce the chance that we tell an already expired token (in server) is good
	endSec = endSec - 60
	var nowSec = Date.now() / 1000
	return endSec < nowSec
}

// isFunction tells whether f is a javascript function
function isFunction (f) {
	return f && {}.toString.call(f) === '[object Function]'
}

// loop executes function func multiple times
function loop (func) {
	if (!isFunction(func)) return
	var called = false
	func(function () {
		if (called) return // make sure only call 1
		called = true

		setTimeout(loop, 1000, func)
	})
}

// Token define new token helper object

function Token(param) {
	param = param || {}
	var me = this
	me.api = (param.ajax || gAjax)
		.post(param.tokenep)
		.setParser('json')
		.contentTypeForm()
	me.term = 0

	me.get = function () {
		return new Promise(function (rs) {
			var tk = store.get(STOREID)
			me.data = me.data || tk
			if (!me.data) return rs({ error: 'uninitialized' })
			if (isAccountChange(me.data, tk)) return rs({ error: 'account_changed' })

			if (!isGoodToken(me.data.created, me.data.expires_in)) {
				return rs(Object.assign({}, me.data))
			}

			var retry = 5
			var p = { refresh_token: tk.refresh_token }
			var term = me.term
			loop(function (continueLoop) {
				me.api.send(p).then(function (code, body, err) {
					if (term !== me.term) {
						// our term has outdated, return latest data of new term
						me.get().then(rs)
						return
					}

					if ((err || code > 499) && retry > 0) {
						// should retry 5 time
						retry--
						continueLoop()
						return
					}

					if (err || code !== 200) {
						rs({ error: err })
						return
					}

					if (isAccountChange(tk, store.get(STOREID) || {})) {
						rs({ error: 'account_changed' })
						return
					}

					me.reset(body) // update internal token using returned body
					rs(me.data)
				})
			})
		})
	}

	me.reset = function (body) {
		me.term++
		me.data = {
			account_id: body.account_id,
			agent_id: body.agent_id,
			access_token: body.access_token,
			refresh_token: body.refresh_token,
			created: new Date(),
			expires_in: body.expires_in, // 3600
		}

		store.set(STOREID, me.data)
	}
}

module.exports = { Token: Token }

var STOREID = 'sbztokn'
