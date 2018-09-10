let index = require('./index.js')

class TokenMock {
	A (transition, str) {
		transition('B', str)
	}

	B (transition, param) {
		if (param !== 'van') transition('x', 'should be 4')
		else transition('C', undefined, 100)
	}

	C (transition) {
		transition('exit', 'ok')
	}
}

test('run', async () => {
	let token = new TokenMock()
	let out = await index.run(token, 'A', 'thanh')
	expect(out).toContain('should be 4')

	out = await index.run(token, 'A', 'van')
	expect(out).toContain('ok')
})

test('loop', async () => {
	let i = 0
	let err = await index.loop4ever(resolve => {
		i++
		if (i < 10) {
			resolve(1)
			return
		}

		resolve(0, 'err44')
	})
	expect(err).toBe('err44')
})

test('pure refresh should return REFRESHING on network err', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, _, d] = token.pureRefresh(
		now,
		{ refresh_token: 'rf_123' },
		null,
		null,
		null,
		'network err'
	)
	expect(t.refresh_token).toBe('rf_123')
	expect(s).toBe('REFRESHING')
	expect(d).toBeGreaterThan(100)
})

test('pure refresh should return REFRESHING on server err', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()

	let [t, s, _, d] = token.pureRefresh(
		now,
		{ refresh_token: 'rf_123' },
		null,
		500
	)
	expect(t.refresh_token).toBe('rf_123')
	expect(s).toBe('REFRESHING')
	expect(d).toBeGreaterThan(100)
})

test('pure refresh should return DEAD on token expired', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, p, _] = token.pureRefresh(
		now,
		{ refresh_token: 'rf_123', account_id: 'thanh' },
		{ refresh_token: 'rf_123', account_id: 'thanh' },
		421,
		null
	)
	expect(t).toBeUndefined()
	expect(s).toBe('DEAD')
	expect(p).toBe('expired')
})

test('pure refresh should return DEAD on change account', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, p, _] = token.pureRefresh(
		now,
		{ refresh_token: 'rf_123', account_id: 'thanh' },
		{ refresh_token: 'rf_1234', account_id: 'van' },
		421
	)
	expect(t).toBeUndefined()
	expect(s).toBe('DEAD')
	expect(p).toBe('account_changed')
})

test('pure refresh should return JUST_REFRESHED on new token from other process in same account', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, p] = token.pureRefresh(
		now,
		{ refresh_token: 'rf_123', account_id: 'van' },
		{ refresh_token: 'rf_1234', account_id: 'van' },
		421
	)
	expect(t.refresh_token).toBe('rf_1234')
	expect(s).toBe('JUST_REFRESHED')
	expect(p).toEqual({ now })
})

test('pure refresh should return JUST_REFRESHED on new token', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, p] = token.pureRefresh(
		now,
		{ refresh_token: 'rf_123', account_id: 'van' },
		{ refresh_token: 'rf_123', account_id: 'van' },
		200,
		JSON.stringify({
			account_id: 'van',
			access_token: 'ac_2108',
			refresh_token: 'rf_2910',
		})
	)
	expect(t.refresh_token).toBe('rf_2910')
	expect(t.access_token).toBe('ac_2108')
	expect(s).toBe('JUST_REFRESHED')
	expect(p).toEqual({ now })
})

test('pure refresh should return err on invalid json', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()

	let [t, s, p] = token.pureRefresh(
		now,
		'rf_123',
		{ refresh_token: 'rf_1234' },
		200,
		'adf'
	)
	expect(s).toBe('DEAD')
	expect(t).toBeUndefined()
	expect(p + '').toContain('JSON')
})

test('just refresh state', done => {
	let token = new index.Token({ dry: true })
	var pm1 = token.refresh()
	var pm2 = token.refresh()

	token.JUST_REFRESHED(
		(state, param) => {
			expect(param.now).toBe(1000)
			expect(param.then).toBeGreaterThan(2000)

			expect(state).toBe('JUST_REFRESHED')
			var pm3 = token.refresh()
			token.JUST_REFRESHED(
				state => {
					expect(state).toBe('NORMAL')

					pm1
						.then(pm2)
						.then(pm3)
						.then(done)
				},
				{ now: 0, then: 6000 }
			)
		},
		{ now: 1000, then: 2000 }
	)
})

test('normal state', done => {
	let token = new index.Token({ dry: true })

	token.NORMAL((state, param, delay) => {
		expect(state).toBe('NORMAL')

		let token = new index.Token({ dry: true })
		token.refresh()
		token.NORMAL((state, param, delay) => {
			expect(state).toBe('REFRESHING')
			expect(delay).toBeUndefined()
			done()
		})
	})
})

test('dead state', done => {
	let token = new index.Token({ dry: true })
	let rpm = token.refresh() // return a promise so we can evaluate later

	token.DEAD(state => {
		expect(state).toBe('DEAD')

		let token = new index.Token({ dry: true })
		let pm = token.restart()
		token.DEAD(state => {
			expect(state).toBe('NORMAL')
			rpm.then(err => {
				expect(err).toContain('dead')
				pm.then(done)
			})
		})
	})
})
