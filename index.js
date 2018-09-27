var store = require('store')
var gAjax = require('@subiz/ajax')

function loop4everInternal (f, r) {
	return f(function (delay, err) {
		return err ? r(err) : setTimeout(loop4everInternal, delay, f, r)
	})
}

function loop4ever (f) {
	return new Promise(function (resolve) {
		return loop4everInternal(f, resolve)
	})
}

function isAccountChange (a, b) {
	if (!a) return b
	return a.account_id !== b.account_id || a.agent_id !== b.agent_id
}

function getStore () {
	return store.get('sbztokn') || {}
}

function setStore (k, v) {
	return store.set(k, v)
}

function run (self, state, param) {
	return loop4ever(function (resolve) {
		var f = self[state]
		if (typeof f !== 'function') {
			resolve(undefined, "invalid state '" + state + "', param " + param)
			return
		}
		f.bind(self)(function (nextstate, nextparam, delay) {
			state = nextstate
			param = nextparam
			resolve(parseInt(delay) || 1)
		}, param)
	})
}

function Token (param) {
	var tokenep = param.tokenep
	var ajax = param.ajax
	var dry = param.dry

	var api = (ajax || gAjax).post(tokenep).setParser('json')
	this.api = api.setContentType('form')
	this.refreshQ = []
	this.restartQ = []
	if (!dry) run(this, 'NORMAL')

	var me = this
	this.get = function () {
		var store = getStore()
		if (isAccountChange(me.data, store)) {
			return { error: 'account_changed' }
		}
		if (!me.data.refresh_token && !store.refresh_token) {
			return { error: 'uninitialized' }
		}
		return Object.assign({}, me.data, store)
	}

	this.set = function (param) {
		me.data = {
			account_id: param.account_id,
			agent_id: param.agent_id,
			access_token: param.access_token,
			refresh_token: param.refresh_token,
			session: param.session,
		}
		setStore('sbztokn', me.data)
	}

	this.refresh = function () {
		return new Promise(function (resolve) {
			me.refreshQ.push({ resolve: resolve })
		})
	}

	this.restart = function () {
		return new Promise(function (resolve) {
			me.restartQ.push({ resolve: resolve })
		})
	}

	this.NORMAL = function (transition) {
		if (me.refreshQ.length > 0) transition('REFRESHING')
		else transition('NORMAL', undefined, 100)
	}

	this.JUST_REFRESHED = function (transition, param) {
		var now = param.now
		var then = param.then
		me.refreshQ.forEach(function (req) {
			return req.resolve()
		})
		me.refreshQ = []
		if (then - now > 5000) transition('NORMAL')
		else { transition('JUST_REFRESHED', { now: now, then: then + 100 || 100 }, 100) }
	}

	this.pureRefresh = function (now, ltk, gtk, code, body, err) {
		if (err || code > 499) {
			// network error or server error
			return [ltk, 'REFRESHING', undefined, 1000]
		}
		if (code !== 200) {
			if (isAccountChange(ltk, gtk)) {
				return [undefined, 'DEAD', 'account_changed']
			}
			if (gtk.refresh_token && gtk.refresh_token !== ltk.refresh_token) {
				// someone have exchanged the token
				return [gtk, 'JUST_REFRESHED', { now: now }]
			}
			return [undefined, 'DEAD', 'expired']
		}

		try {
			var tk = JSON.parse(body)
			var newtok = {
				// dont access invalid param from server
				access_token: tk.access_token,
				refresh_token: tk.refresh_token,
				account_id: tk.account_id,
				id: tk.id,
				session: tk.session,
			}
			return [newtok, 'JUST_REFRESHED', { now: now }]
		} catch (e) {
			return [undefined, 'DEAD', e]
		}
	}

	this.REFRESHING = function (transition) {
		var tk = me.get()
		if (tk.error) {
			return transition('DEAD', tk.error)
		}
		var pm = me.api.send({
			refresh_token: tk.refresh_token,
			session: tk.session,
		})
		pm.then(function (ret) {
			var code = ret[0]
			var body = ret[1]
			var err = ret[2]
			var gtk = getStore()
			var now = new Date()
			var out = me.pureRefresh(now, tk, gtk, code, body, err)
			if (out[0]) me.set(out[0])
			transition(out[1], out[2], out[3])
		})
	}

	this.DEAD = function (transition, msg) {
		me.refreshQ.map(function (req) {
			return req.resolve('dead ' + msg)
		})
		me.refreshQ = []

		me.restartQ.map(function (req) {
			return req.resolve()
		})
		if (me.restartQ.length > 0) {
			me.restartQ = []
			transition('NORMAL')
		} else transition('DEAD', undefined, 100)
	}
}

module.exports = { Token: Token, loop4ever: loop4ever, run: run }
