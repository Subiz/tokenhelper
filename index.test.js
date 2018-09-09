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
	let [t, s, _, d, e] = token.pureRefresh(
		now,
		'rf_123',
		null,
		null,
		null,
		'network err'
	)
	expect(e).toBeUndefined()
	expect(t.refresh_token).toBe('rf_123')
	expect(s).toBe(index.REFRESHING)
	expect(d).toBeGreaterThan(100)
})

test('pure refresh should return REFRESHING on server err', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, _, d, e] = token.pureRefresh(now, 'rf_123', null, 500, null)
	expect(e).toBeUndefined()
	expect(t.refresh_token).toBe('rf_123')
	expect(s).toBe(index.REFRESHING)
	expect(d).toBeGreaterThan(100)
})

test('pure refresh should return DEAD on token expired', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, _, _2, e] = token.pureRefresh(
		now,
		'rf_123',
		{ refresh_token: 'rf_123' },
		421,
		null
	)
	expect(e).toBeUndefined()
	expect(t.refresh_token).toBeUndefined()
	expect(s).toBe(index.DEAD)
})

test('pure refresh should return JUST_REFRESHED on new token from other process', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, p, _, e] = token.pureRefresh(
		now,
		'rf_123',
		{ refresh_token: 'rf_1234' },
		421,
		null
	)
	expect(e).toBeUndefined()
	expect(t.refresh_token).toBe('rf_1234')
	expect(s).toBe(index.JUST_REFRESHED)
	expect(p).toEqual({ now })
})

test('pure refresh should return JUST_REFRESHED on new token', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()
	let [t, s, p, _, e] = token.pureRefresh(
		now,
		'rf_123',
		{ refresh_token: 'rf_1234' },
		200,
		JSON.stringify({ access_token: 'ac_2108', refresh_token: 'rf_2910' })
	)
	expect(e).toBeUndefined()
	expect(t.refresh_token).toBe('rf_2910')
	expect(t.access_token).toBe('ac_2108')
	expect(s).toBe(index.JUST_REFRESHED)
	expect(p).toEqual({ now })
})

test('pure refresh should return JUST_REFRESHED on new token', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()

	let [t, s, _, d, e] = token.pureRefresh(
		now,
		'rf_123',
		{ refresh_token: 'rf_1234' },
		200,
		JSON.stringify({ access_token: 'ac_2108', refresh_token: 'rf_2910' })
	)
	expect(e).toBeUndefined()
	expect(t.refresh_token).toBe('rf_2910')
	expect(t.access_token).toBe('ac_2108')
	expect(s).toBe(index.JUST_REFRESHED)
})

test('pure refresh should return err on invalid json', () => {
	let token = new index.Token({ dry: true })
	let now = new Date()

	let [t, s, _, d, e] = token.pureRefresh(
		now,
		'rf_123',
		{ refresh_token: 'rf_1234' },
		200,
		'adf'
	)
	expect(e).toBeDefined()
	expect(t).toBeUndefined()
	expect(s).toBeUndefined()
})

test('just refresh state', done => {
	let token = new index.Token({ dry: true })
	var pm1 = token.refresh()
	var pm2 = token.refresh()

	token.JUST_REFRESHED(
		(state, param) => {
			expect(param.now).toBe(1000)
			expect(param.then).toBeGreaterThan(2000)

			expect(state).toBe(index.JUST_REFRESHED)
			var pm3 = token.refresh()
			token.JUST_REFRESHED(
				state => {
					expect(state).toBe(index.NORMAL)

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
		expect(state).toBe(index.NORMAL)

		let token = new index.Token({ dry: true })
		token.refresh()
		token.NORMAL((state, param, delay) => {
			expect(state).toBe(index.REFRESHING)
			expect(delay).toBeUndefined()
			done()
		})
	})
})

test('dead state', done => {
	let token = new index.Token({ dry: true })
	let rpm = token.refresh() // return a promise so we can evaluate later

	token.DEAD(state => {
		expect(state).toBe(index.DEAD)

		let token = new index.Token({ dry: true })
		let pm = token.restart()
		token.DEAD(state => {
			expect(state).toBe(index.NORMAL)
			rpm.then(err => {
				expect(err).toContain('dead')
				pm.then(done)
			})
		})
	})
})
