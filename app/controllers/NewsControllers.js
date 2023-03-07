class NewsController {
    index(req,res) {
        res.render('news')
    }

    show(req, res) {
        res.send('00000000')
    }
}


module.exports = new NewsController
