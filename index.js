const gStore = require('store')
const gAjax = require('@subiz/ajax')

const DEAD = 'dead'
const REFRESHING = 'refreshing'
const NORMAL = 'normal'
const JUST_REFRESHED = 'just_refreshed'

const loop4everInternal = (f, r) =>
	f((delay, err) => (err ? r(err) : setTimeout(loop4everInternal, delay, f, r)))

const loop4ever = f => new Promise(resolve => loop4everInternal(f, resolve))

const run = (self, state, param) =>
	loop4ever(resolve => {
		const f = self[state]
		if (typeof f !== 'function') {
			resolve(undefined, `invalid state '${state}', param ${param}`)
			return
		}
		f((nextstate, nextparam, delay) => {
			[state, param] = [nextstate, nextparam]
			resolve(parseInt(delay) || 1)
		}, param)
	})

class Token {
	constructor ({ tokenep, ajax, store, dry }) {
		let api = (ajax || gAjax).post(tokenep).setParser('json')
		this.api = api.setContentType('form')
		this.refreshQ = []
		this.restartQ = []
		this.store = store || gStore
		dry || run(this, NORMAL)
	}

	getStore () {
		return this.store.get('sbztokn') || {}
	}

	load () {
		if (!this.actoken) this.actoken = this.getStore().access_token
		if (!this.rftoken) this.rftoken = this.getStore().refresh_token
		return { access_token: this.actoken, refresh_token: this.rftoken }
	}

	set (actoken, rftoken) {
		[this.actoken, this.rftoken] = [actoken, rftoken]
		this.store.set('sbztokn', { refresh_token: rftoken, access_token: actoken })
	}

	refresh () {
		return new Promise(resolve => this.refreshQ.push({ resolve }))
	}

	restart () {
		return new Promise(resolve => this.restartQ.push({ resolve }))
	}

	NORMAL (transition) {
		if (this.refreshQ.length > 0) transition(REFRESHING)
		else transition(NORMAL, undefined, 100)
	}

	JUST_REFRESHED (transition, { now, then }) {
		this.refreshQ.forEach(req => req.resolve())
		this.refreshQ = []
		if (then - now > 5000) transition(NORMAL)
		else transition(JUST_REFRESHED, { now, then: then + 100 || 100 }, 100)
	}

	pureRefresh (now, rftoken, gtok, code, body, err) {
		if (err || code > 499) {
			/* network error or server error */
			return [{ refresh_token: rftoken }, REFRESHING, undefined, 1000]
		}
		if (code !== 200) {
			if (gtok.refresh_token && gtok.refresh_token !== rftoken) {
				/* someone have exchanged the token */
				return [gtok, JUST_REFRESHED, { now }]
			}
			return [{}, DEAD]
		}

		try {
			let tk = JSON.parse(body)
			let s = { access_token: tk.access_token, refresh_token: tk.refresh_token }
			return [s, JUST_REFRESHED, { now }]
		} catch (e) {
			return [undefined, undefined, undefined, undefined, e]
		}
	}

	REFRESHING (transition) {
		let rftok = this.load().refresh_token
		if (!rftok) return transition(DEAD)
		let pm = this.api.query({ 'refresh-token': rftok }).send()
		pm.then(([code, body, err]) => {
			let [gtok, now] = [this.getStore(), new Date()]
			let [t, s, p, d, e] = this.pureRefresh(now, rftok, gtok, code, body, err)
			if (e) {
				console.error(e)
				transition(DEAD)
				return
			}
			this.set(t.access_token, t.refresh_token)
			transition(s, p, d)
		})
	}

	DEAD (transition) {
		this.refreshQ.map(req => req.resolve('dead'))
		this.refreshQ = []

		this.restartQ.map(req => req.resolve())
		if (this.restartQ.length > 0) {
			this.restartQ = []
			transition(NORMAL)
		} else transition(DEAD, undefined, 100)
	}
}

module.exports = {
	Token,
	loop4ever,
	run,
	DEAD,
	REFRESHING,
	NORMAL,
	JUST_REFRESHED,
}
