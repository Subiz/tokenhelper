const store = require('store')
const gAjax = require('@subiz/ajax')

const loop4everInternal = (f, r) =>
	f((delay, err) => (err ? r(err) : setTimeout(loop4everInternal, delay, f, r)))

const loop4ever = f => new Promise(resolve => loop4everInternal(f, resolve))

function isAccountChange (a, b) {
	if (!a) return b
	return a.account_id != b.account_id || a.agent_id != b.agent_id
}

const getStore = _ => store.get('sbztokn') || {}
const setStore = (k, v) => store.set(k, v)

const run = (self, state, param) =>
	loop4ever(resolve => {
		const f = self[state]
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
		let api = (ajax || gAjax).post(tokenep).setParser('json')
		this.api = api.setContentType('form')
		this.refreshQ = []
		this.restartQ = []
		if (dry) run(this, 'NORMAL')
	}

	get () {
		const store = getStore()
		if (isAccountChange(this.data, store)) {
			return { error: 'account_changed' }
		}
		if (!this.data.refresh_token && !store.refresh_token) {
			return { error: 'uninitialized' }
		}
		return Object.assign({}, this.data, store)
	}

	set ({ account_id, agent_id, email, access_token, refresh_token }) {
		this.data = { account_id, agent_id, email, access_token, refresh_token }
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
			/* network error or server error */
			return [ltk, 'REFRESHING', undefined, 1000]
		}
		if (code !== 200) {
			if (isAccountChange(ltk, gtk)) {
				return [undefined, 'DEAD', 'account_changed']
			}
			if (gtk.refresh_token && gtk.refresh_token !== ltk.refresh_token) {
				/* someone have exchanged the token */
				return [gtk, 'JUST_REFRESHED', { now }]
			}
			return [undefined, 'DEAD', 'expired']
		}

		try {
			let tk = JSON.parse(body)
			let newtok = {
				access_token: tk.access_token,
				refresh_token: tk.refresh_token,
				account_id: tk.account_id,
				id: tk.id,
				email: tk.email,
			}
			return [newtok, 'JUST_REFRESHED', { now }]
		} catch (e) {
			return [undefined, 'DEAD', e]
		}
	}

	REFRESHING (transition) {
		let tk = this.get()
		if (tk.error) {
			return transition('DEAD', tk.error)
		}

		let pm = this.api.setQuery({ 'refresh-token': tk.refresh_token }).send()
		pm.then(([code, body, err]) => {
			let [gtk, now] = [getStore(), new Date()]
			let [t, s, p, d] = this.pureRefresh(now, tk, gtk, code, body, err)
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
