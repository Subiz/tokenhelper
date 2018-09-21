var store = require('store')
var gAjax = require('@subiz/ajax')

var loop4everInternal = (f, r) =>
	f((delay, err) => (err ? r(err) : setTimeout(loop4everInternal, delay, f, r)))

var loop4ever = f => new Promise(resolve => loop4everInternal(f, resolve))

function isAccountChange (a, b) {
	if (!a) return b
	return a.account_id !== b.account_id || a.agent_id !== b.agent_id
}

var getStore = _ => store.get('sbztokn') || {}
var setStore = (k, v) => store.set(k, v)

var run = (self, state, param) =>
	loop4ever(resolve => {
		var f = self[state]
		if (typeof f !== 'function') {
			resolve(undefined, `invalid state '${state}', param ${param}`)
			return
		}
		f.bind(self)((nextstate, nextparam, delay) => {
			[state, param] = [nextstate, nextparam]
			resolve(parseInt(delay) || 1)
		}, param)
	})

class Token {
	constructor ({ tokenep, ajax, dry }) {
		var api = (ajax || gAjax).post(tokenep).setParser('json')
		this.api = api.setContentType('form')
		this.refreshQ = []
		this.restartQ = []
		if (!dry) run(this, 'NORMAL')
	}

	get () {
		var store = getStore()
		if (isAccountChange(this.data, store)) {
			return { error: 'account_changed' }
		}
		if (!this.data.refresh_token && !store.refresh_token) {
			return { error: 'uninitialized' }
		}
		return Object.assign({}, this.data, store)
	}

	set ({ account_id, agent_id, access_token, refresh_token, session }) {
		this.data = { account_id, agent_id, access_token, refresh_token, session }
		setStore('sbztokn', this.data)
	}

	refresh () {
		return new Promise(resolve => this.refreshQ.push({ resolve }))
	}

	restart () {
		return new Promise(resolve => this.restartQ.push({ resolve }))
	}

	NORMAL (transition) {
		if (this.refreshQ.length > 0) transition('REFRESHING')
		else transition('NORMAL', undefined, 100)
	}

	JUST_REFRESHED (transition, { now, then }) {
		this.refreshQ.forEach(req => req.resolve())
		this.refreshQ = []
		if (then - now > 5000) transition('NORMAL')
		else transition('JUST_REFRESHED', { now, then: then + 100 || 100 }, 100)
	}

	pureRefresh (now, ltk, gtk, code, body, err) {
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
				return [gtk, 'JUST_REFRESHED', { now }]
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
			return [newtok, 'JUST_REFRESHED', { now }]
		} catch (e) {
			return [undefined, 'DEAD', e]
		}
	}

	REFRESHING (transition) {
		var tk = this.get()
		if (tk.error) {
			return transition('DEAD', tk.error)
		}
		var pm = this.api.send({
			refresh_token: tk.refresh_token,
			session: tk.session,
		})
		pm.then(([code, body, err]) => {
			var [gtk, now] = [getStore(), new Date()]
			var [t, s, p, d] = this.pureRefresh(now, tk, gtk, code, body, err)
			if (t) this.set(t)
			transition(s, p, d)
		})
	}

	DEAD (transition, msg) {
		this.refreshQ.map(req => req.resolve(`dead ${msg}`))
		this.refreshQ = []

		this.restartQ.map(req => req.resolve())
		if (this.restartQ.length > 0) {
			this.restartQ = []
			transition('NORMAL')
		} else transition('DEAD', undefined, 100)
	}
}

module.exports = { Token, loop4ever, run }
