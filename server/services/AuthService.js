import bcrypt from 'bcryptjs';
import { now, transaction } from '../db/database.js';
import { CreditTransaction, User } from '../models/index.js';
import { config } from '../config/index.js';

export class AuthService {
  async register({ name, email, password, terms }) {
    if (!config.registrationEnabled) {
      throw authError('Registration is currently disabled.', 403);
    }
    if (!terms) {
      throw authError('請勾選 AI 工具使用條款', 422);
    }
    if (!name || !email || !password) {
      throw authError('請填寫名稱、Email 與密碼', 422);
    }
    if (String(password).length < 8) {
      throw authError('密碼至少 8 碼', 422);
    }
    if (User.findWithPasswordByEmail(email)) {
      throw authError('Email 已註冊', 422);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let userId;
    transaction(() => {
      const freeCredits = Math.max(0, Number(config.freeCreditsOnSignup || 0));
      userId = User.create({
        name,
        email: String(email).toLowerCase(),
        password: passwordHash,
        google_id: null,
        role: 'user',
        credits_balance: freeCredits,
        status: 'active',
        created_at: now(),
        updated_at: now(),
      });
      CreditTransaction.create({
        user_id: userId,
        type: 'grant',
        amount: freeCredits,
        balance_after: freeCredits,
        related_task_id: null,
        note: `Signup grant ${freeCredits} credits`,
      });
    });
    return User.find(userId);
  }

  async login({ email, password }) {
    const user = User.findWithPasswordByEmail(email);
    if (!user || !(await bcrypt.compare(password || '', user.password))) {
      throw authError('Email 或密碼錯誤', 422);
    }
    if (user.status !== 'active') {
      throw authError('帳號已停權', 403);
    }
    return User.find(user.id);
  }
}

function authError(message, status = 401) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const authService = new AuthService();
