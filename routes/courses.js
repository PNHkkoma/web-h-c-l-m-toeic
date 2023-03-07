var express = require('express')
var router = express.Router()

const courseController = require('../app/controllers/CourseControllers')

//NewsController.index
router.get('/create', courseController.create)
router.post('/store', courseController.store)
router.post('/handle-form-actions', courseController.handleFormActions)
router.get('/:id/edit', courseController.edit)
router.put('/:id', courseController.update)
router.delete('/:id', courseController.delete)
router.get('/:slug', courseController.show)

module.exports = router