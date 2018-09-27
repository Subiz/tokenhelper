var store = require('store')
var gAjax = require('@subiz/ajax')

function resolveReq (msg) {
	return function (req) {
		req.resolve(msg)
	}
}

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

function makeQueue () {
	var q = []

	var f = function () {
		return new Promise(function (resolve) {
			q.push({ resolve: resolve })
		})
	}

	f.resolve = function (msg) {
		q.forEach(resolveReq(msg))
	}

	f.reset = function () {
		q = []
	}

	f.len = function () {
		return q.length
	}

	return f
}

function getStoreFromData (data) {
	var store = getStore()
	if (isAccountChange(data, store)) {
		return { error: 'account_changed' }
	}
	if (!data.refresh_token && !store.refresh_token) {
		return { error: 'uninitialized' }
	}
	return Object.assign({}, data, store)
}

function filterData (param) {
	return {
		account_id: param.account_id,
		agent_id: param.agent_id,
		access_token: param.access_token,
		refresh_token: param.refresh_token,
		session: param.session,
	}
}

function Token (param) {
	var me = this
	var api = (param.ajax || gAjax).post(param.tokenep).setParser('json')
	this.api = api.setContentType('form')
	this.refresh = makeQueue()
	this.restart = makeQueue()

	this.get = function () {
		return getStoreFromData(me.data)
	}

	this.set = function (param) {
		me.data = filterData(param)
		setStore('sbztokn', me.data)
	}

	this.NORMAL = function (transition) {
		if (me.refresh.len() > 0) transition('REFRESHING')
		else transition('NORMAL', undefined, 100)
	}

	this.JUST_REFRESHED = function (transition, param) {
		var now = param.now
		var then = param.then
		me.refresh.resolve()
		me.refresh.reset()
		if (then - now > 5000) transition('NORMAL')
		else {
			transition('JUST_REFRESHED', { now: now, then: then + 100 || 100 }, 100)
		}
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
		me.refresh.resolve('dead ' + msg)
		me.refresh.reset()

		me.restart.resolve()
		if (me.restart.len() > 0) {
			me.restart.reset()
			transition('NORMAL')
		} else transition('DEAD', undefined, 100)
	}

	if (!param.dry) run(this, 'NORMAL')
}

module.exports = { Token: Token, loop4ever: loop4ever, run: run }
