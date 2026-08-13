/**
 * =============================================================================
 *  adminAuthController.ts — Admin Dashboard Authentication
 * =============================================================================
 *
 * Controllers:
 *   adminLogin          — POST /api/auth/admin/login (userId + password → JWT)
 *   adminProfile        — GET  /api/auth/admin/profile (current user info)
 *   adminUpdateProfile  — PUT  /api/auth/admin/profile (update name)
 *   adminChangePassword — PUT  /api/auth/admin/change-password
 *
 * Notes:
 *   - Admin uses 'userId' (not 'username') for login
 *   - Only 'super_admin' role can access admin dashboard
 *   - Password validation via bcrypt.compare()
 *   - JWT expires in 24h
 */

import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { config } from '../config';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

export async function adminLogin(req: Request, res: Response): Promise<void> {
  try {
    const { userId, password } = req.body;
    const user = await User.findOne({ userId: userId?.toLowerCase(), role: 'super_admin', isDeleted: { $ne: true } }).exec();
    if (!user) {
      res.status(401).json({ message: 'Invalid userId or password' });
      return;
    }
    if (user.status !== 'active') {
      res.status(403).json({ message: 'Account is inactive or suspended' });
      return;
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ message: 'Invalid userId or password' });
      return;
    }
    await User.updateOne({ _id: user._id }, { lastLogin: new Date() }).exec();
    const tokenPayload = {
      userId: user._id.toString(),
      restaurantId: user.restaurantId.toString(),
      role: 'super_admin' as const,
      name: user.name,
      surface: 'admin' as const, // admin-dashboard surface — rejected on POS routes
    };
    const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn: '24h', issuer: config.jwtIssuer });
    res.json({
      token,
      user: {
        id: user._id.toString(),
        userId: user.userId,
        name: user.name,
        role: 'SUPER_ADMIN',
        avatar: undefined,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[AdminAuth] Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function adminProfile(req: Request, res: Response): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = await User.findById(authReq.user?.userId).exec();
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    res.json({
      id: user._id.toString(),
      userId: user.userId,
      name: user.name,
      role: 'SUPER_ADMIN',
      avatar: undefined,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[AdminAuth] Profile error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function adminUpdateProfile(req: Request, res: Response): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name } = req.body;
    const user = await User.findByIdAndUpdate(authReq.user?.userId, { name }, { new: true }).exec();
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    res.json({
      id: user._id.toString(), userId: user.userId, name: user.name,
      role: 'SUPER_ADMIN', avatar: undefined, createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('[AdminAuth] Update profile error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

export async function adminChangePassword(req: Request, res: Response): Promise<void> {
  try {
    const authReq = req as AuthenticatedRequest;
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(authReq.user?.userId).exec();
    if (!user) { res.status(404).json({ message: 'User not found' }); return; }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) { res.status(400).json({ message: 'Current password is incorrect' }); return; }
    const hashed = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ _id: user._id }, { password: hashed }).exec();
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('[AdminAuth] Change password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
