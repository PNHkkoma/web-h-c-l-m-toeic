const newsRouter = require('./news')
const meRouter = require('./me')
const coursesRouter = require('./courses')
const siteRouter = require('./site')

function rounte(app) {

    app.use('/search', siteRouter) 
    app.use('/courses', coursesRouter)
    app.use('/me', meRouter)
    app.use('/', siteRouter)
}

module.exports = rounte;