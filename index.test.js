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

test('just refresh state', done => {
	let token = new index.Token({ dry: true, })
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
				{ now: 0, then: 6000, }
			)
		},
		{ now: 1000, then: 2000, }
	)
})

test('normal state', done => {
	let token = new index.Token({ dry: true, })

	token.NORMAL((state, param, delay) => {
		expect(state).toBe(index.NORMAL)

		let token = new index.Token({ dry: true, })
		token.refresh()
		token.NORMAL((state, param, delay) => {
			expect(state).toBe(index.REFRESHING)
			expect(delay).toBeUndefined()
			done()
		})
	})
})

test('dead state', done => {
	let token = new index.Token({ dry: true, })
	let rpm = token.refresh() // return a promise so we can evaluate later

	token.DEAD(state => {
		expect(state).toBe(index.DEAD)

		let token = new index.Token({ dry: true, })
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
