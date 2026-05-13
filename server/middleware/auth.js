import { randomBytes } from 'node:crypto';
import { User } from '../models/index.js';

export function attachUser(req, _res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(24).toString('hex');
  }
  const userId = req.session.userId;
  req.user = userId ? User.find(userId) : null;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(httpError('請先登入', 401));
  }
  if (req.user.status !== 'active') {
    return next(httpError('帳號已停權', 403));
  }
  return next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) {
    return next(httpError('請先登入', 401));
  }
  if (req.user.role !== 'admin') {
    return next(httpError('需要管理員權限', 403));
  }
  return next();
}

export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token') || req.body?._csrf;
  if (!token || token !== req.session.csrfToken) {
    return next(httpError('CSRF token 無效，請重新整理頁面', 419));
  }
  return next();
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
