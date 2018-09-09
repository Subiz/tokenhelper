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
