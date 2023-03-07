const express = require('express');
const passport = require('passport');
const router = express.Router();

// Đăng ký tài khoản
router.post('/signup', passport.authenticate('signup', { session: false }), function(req, res, next) {
  res.json({ message: 'Đăng ký thành công' });
});

// Đăng nhập tài khoản
router.post('/login', function(req, res, next) {
  passport.authenticate('login', function(err, user, info) {
    if (err) { return next(err); }
    if (!user) { return res.status(401).json({ message: 'Tên người dùng hoặc mật khẩu không đúng' }); }
    req.logIn(user, function(err) {
      if (err) { return next(err); }
      return res.json({ message: 'Đăng nhập thành công' });
    });
  })(req, res, next);
});

module.exports = router;



