import models from '../db/models'
import moment from 'moment'
import sequelizeSession from 'connect-session-sequelize'
import createUploadClient from '../helpers/awsClient'
import session from 'express-session'
import csp from 'helmet-csp'
import config from 'config'
import Sequelize from 'sequelize'
import passport from '../helpers/authenticationStrategy'
import { matchPath } from 'react-router-dom'

const SequelizeStore = sequelizeSession(session.Store)
const sessionDB = new Sequelize(
  config.get('sessionDb.database'),
  config.get('sessionDb.username'),
  config.get('sessionDb.password'),
  config.get('sessionDb')
)

sessionDB.sync()

// Content Security Policy
export function contentSecurityPolicy (inlineScriptNonce) {
  return csp(
    {
      directives: {
        scriptSrc: ["'self'", config.get('assets.host'), 'open.mapquestapi.com', `'nonce-${inlineScriptNonce}'`],
        styleSrc: ["'self'", config.get('assets.host'), 'fonts.googleapis.com', 'cdnjs.cloudflare.com', "'unsafe-inline'"],
        imgSrc: ["'self'", config.get('assets.host'),  '*.ioverlander.com', 'data:', '*.tile.openstreetmap.org', 'cdnjs.cloudflare.com', '*.tiles.mapbox.com', '*.mqcdn.com', '*.mapquestapi.com', 's3-us-west-2.amazonaws.com'],
        fontSrc: ["'self'", config.get('assets.host'), 'fonts.gstatic.com'],
        objectSrc: ["'none'"]
      }
    }
  )
}

// Session Management
export function sessions () {
  return session({
    resave: true,
    saveUninitialized: true,
    secret: config.get('sessionSettings.secret'),
    store: new SequelizeStore({ db: sessionDB }),
    cookie: {
      secure: config.get('sessionSettings.secure'),
      domain: config.get('domain')
    }
  })
}

// Healthcheck endpoint
export function healthCheck () {
  return (req, res) => {
    res.json({ UP: true })
  }
}

// Cross-Origin-Resource-Sharing
// TODO: clean this up
export function cors () {
  return (req, res, next) => {
    if (req.hostname.indexOf('ioverlander.com') > -1 || req.hostname === 'localhost') {
      res.set('Access-Control-Allow-Origin', '*')
    }
    next()
  }
}

// Login
export function login () {
  return (req, res, next) => {
    passport.authenticate('local', function (err, user, info) {
      if (info && info.message) { req.flash('error', info.message) }
      if (err) { return next(err) }
      if (!user) { return res.redirect('/users/sign_in') }
      req.logIn(user, function (err) {
        if (err) { return next(err) }
        req.session.save(() => {
          return res.redirect(req.session.targetUrl || '/blogs/' + user.blog_id)
        })
      })
    })(req, res, next)
  }
}

// Logout
export function logout () {
  return (req, res) => {
    req.logout()
    req.session.destroy()
    res.set('Set-cookie', 'connect.sid=DEL;expires=Sun, 15 Jul 2012 00:00:01 GMT')
    res.redirect('/')
  }
}

// Logged in user info
export function getUserInfo () {
  return (req, res, next) => {
    res.json(req.user)
  }
}

// Check user has the required role
export function checkRole (routes) {
  return (req, res, next) => {
    let requiredRole = null

    routes.some(route => {
      const match = matchPath(req.url, Object.assign(
        {},
        { exact: true },
        route
      ))

      if (match && route.role_required) {
        requiredRole = route.role_required
      }
    })

    const roleRequired = requiredRole !== null
    const hasRequiredRole = req.user && req.user.role === requiredRole

    if (roleRequired && hasRequiredRole) {
      next()
    } else if (!roleRequired) {
      next()
    } else {
      req.flash('error', 'You must sign in to view this page')
      res.redirect('/users/sign_in')
    }
  }
}

// Handle user image uploads
export function uploadUserImages () {
  return (req, res, next) => {
    const images = []

    req.files.forEach((file, index) => {
      models.images.build({
        source_url: null,
        guid: null,
        blog_id: req.user.blog_id,
        imageable_id: req.body.check_in_id,
        imageable_type: 'CheckIn|BETA',
        pgfile_fingerprint: null,
        created_at: moment().format('YYYY-MM-DD HH:mm:ss.SSSSSS'),
        updated_at: moment().format('YYYY-MM-DD HH:mm:ss.SSSSSS'),
        jpgfile_file_name: file.originalname,
        jpgfile_content_type: file.mimetype,
        jpgfile_file_size: file.size,
        jpgfile_updated_at: moment().format('YYYY-MM-DD HH:mm:ss.SSSSSS'),
        jpgfile_processing: false
      }).save().then((image) => {
        const client = createUploadClient(image.id)

        client.upload(`tmp/${file.filename}`, {}, function (err, versions, meta) {
          if (err) { throw err }
          versions.forEach(function (image) {
            if (image.url.indexOf('small') > -1) {
              images.push(image.url)
            }
          })

          if (index === (req.files.length - 1)) {
            res.status(200)
            res.json({
              previews: images
            })
          }
        })
      })
    })
  }
}
