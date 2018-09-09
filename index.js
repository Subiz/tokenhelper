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
			[state, param, ] = [nextstate, nextparam, ]
			resolve(delay)
		}, param)
	})

class Token {
	constructor ({ tokenep, ajax, store, dry, }) {
		this.api = (ajax || gAjax)
			.post(tokenep)
			.setParser('json')
			.setContentType('form')
		this.refreshQ = []
		this.restartQ = []
		this.store = store || gStore
		dry || run(this, NORMAL)
	}

	loadStore () {
		return this.store.get('subiz_token') || {}
	}

	get () {
		const lcs = this.loadStore()
		if (!this.actoken) this.actoken = lcs.access_token
		if (!this.rftoken) this.rftoken = lcs.refresh_token
		return [this.actoken, this.rftoken, ]
	}

	set (actoken, rftoken) {
		this.actoken = actoken
		this.rftoken = rftoken
		this.store.set('subiz_token', {
			refresh_token: rftoken,
			access_token: actoken,
		})
	}

	refresh () {
		return new Promise(resolve => this.refreshQ.push({ resolve, }))
	}

	restart () {
		return new Promise(resolve => this.restartQ.push({ resolve, }))
	}

	NORMAL (transition) {
		let req = this.refreshQ.pop()
		if (req) transition(REFRESHING, req)
		else transition(NORMAL, undefined, 100)
	}

	JUST_REFRESHED (transition, { now, then, }) {
		this.refreshQ.forEach(req => req.resolve([this.actoken, this.rftoken, ]))
		this.refreshQ = []
		if (then - now > 5000) transition(NORMAL)
		else transition(JUST_REFRESHED, { now, then: then + 100 || 100, }, 100)
	}

	REFRESHING (transition, req) {
		this.api
			.query({ 'refresh-token': this.rftoken, })
			.send()
			.then(([code, body, err, ]) => {
				if (err || code !== 200) {
					let st = this.loadStore()
					if (st.refresh_token && st.refresh_token !== this.rftoken) {
						/* someone have exchanged the token */
						this.set(st.access_token, st.refresh_token)
						return transition(JUST_REFRESHED, { now: new Date(), })
					}
					return transition(DEAD)
				}

				/* parsebody */
				this.set(body.access_token, body.refresh_token)
				return transition(JUST_REFRESHED, { now: new Date(), })
			})
	}

	DEAD (transition) {
		this.refreshQ.map(req => req.resolve([undefined, undefined, 'dead', ]))
		this.refreshQ = []

		this.restartQ.map(req => req.resolve)
		if (this.restartQ.length > 0) {
			this.restartQ = []
			transition(NORMAL)
		} else transition(DEAD, undefined, 100)
	}
}

module.exports = { Token, loop4ever, run, }
