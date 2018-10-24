var store = require('store')
var gAjax = require('@subiz/ajax/index.js')

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
	return a && b && (a.account_id !== b.account_id || a.agent_id !== b.agent_id)
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
	if (!data) data = store
	if (!data) return {}
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
	param = param || {}
	var me = this
	this.api = (param.ajax || gAjax)
		.post(param.tokenep)
		.setParser('json')
		.contentTypeForm()
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
		me.refresh.resolve()
		me.refresh.reset()
		param = param || { now: 0, then: 0 }
		param.then = param.then + 100 || 100
		if (param.then - param.now > 5000) transition('NORMAL')
		else transition('JUST_REFRESHED', param, 100)
	}

	this.REFRESHING = function (transition, param) {
		var tk = me.get()
		if (tk.error) return transition('DEAD', tk.error)
		me.api
			.send({ refresh_token: tk.refresh_token, session: tk.session })
			.then(function (ret) {
				var gtk = getStore()
				var now = new Date()
				var out = pureRefresh(now, tk, gtk, ret[0], ret[1], ret[2], param)
				if (out[0]) me.set(out[0])
				transition(out[1], out[2], out[3])
			})
	}

	this.DEAD = function (transition, msg) {
		me.refresh.resolve('dead ' + msg)
		me.refresh.reset()

		if (!me.restart.len()) return transition('DEAD', undefined, 100)
		me.restart.resolve()
		me.restart.reset()
		transition('NORMAL')
	}

	if (!param.dry) run(this, 'NORMAL')
}

function pureRefresh (now, ltk, gtk, code, body, err, param) {
	if (err || code > 499) {
		// network error or server error
		var retry = (param && param.retry) || 0
		if (retry > 5) return [undefined, 'DEAD', 'server_down']
		return [ltk, 'REFRESHING', { retry: retry + 1, err: err, body: body }, 1000]
	}
	if (code !== 200) {
		if (isAccountChange(ltk, gtk)) {
			return [undefined, 'DEAD', 'account_changed']
		}
		// someone have exchanged the token
		if (gtk.refresh_token && gtk.refresh_token !== ltk.refresh_token) {
			return [gtk, 'JUST_REFRESHED', { now: now }]
		}
		return [undefined, 'DEAD', 'expired']
	}

	var newtok = {
		access_token: body.access_token,
		refresh_token: body.refresh_token,
		account_id: body.account_id,
		id: body.id,
		session: body.session,
	}
	return [newtok, 'JUST_REFRESHED', { now: now }]
}

module.exports = {
	Token: Token,
	loop4ever: loop4ever,
	run: run,
	pureRefresh: pureRefresh,
}
