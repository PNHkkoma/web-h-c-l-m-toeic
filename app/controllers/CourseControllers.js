const Course = require('../models/Course');
const { mongooseToOject } = require('../../util/mongoose');

class CourseController {
    /*async index(req, res) {
    try {
      const courses = await Course.find({});
      res.json(courses);
    } catch (error) {
      res.status(400).json({ error: 'Course not found' });
    }
    }*/

  show(req, res,next) {
    // [GET] /course/:slug
    req.params.slug
    Course.findOne({ slug: req.params.slug })
      .then((course) => { 
        res.render('courses/show', { course: mongooseToOject(course) });
      })
    .catch(next)
  }

  //get
  create(req, res, next) { 
    res.render('courses/create')
  }

  //post
  store(req, res, next) { 
    //body chính là dữ liệu từ form gửi từ client lên với phương tức post
    const formData = req.body
    formData.image = 'https://afdevinfo.com/wp-content/uploads/2017/12/hinh-anh-trai-6-mui.jpg'
    const course = new Course(formData)
    course.save()
      .then(() => res.redirect('/me/stored/courses'))
      .catch(error => {
        
      })
  }

  //get: /courses/:id/edit
  edit(req, res, next) { 
    Course.findById(req.params.id)
      .then(course => res.render('courses/edit', {
        course: mongooseToOject(course)
      }))
      .catch(next)
  }

  //put: /courses/:id
  update(req, res, next) {
    Course.updateOne({ _id: req.params.id }, req.body)
      .then(() => res.redirect('/me/stored/courses'))
      .catch(next)
  }

  //delete: /courses/:id
  delete(req, res, next) {
    Course.deleteOne({ _id: req.params.id })
      .then(() => res.redirect('back'))
      .catch(next)
  }

  //post /courses/handle-form-actions
  handleFormActions(req, res, next) { 
    switch (req.body.action) {
      case 'delete':
        Course.deleteOne({ _id: {$in: req.body.courseIds} })
          .then(() => res.redirect('back'))
          .catch(next)
        break
      default:
        res.json({message: 'Action is invalid'})
    }
  }
}


module.exports = new CourseController
