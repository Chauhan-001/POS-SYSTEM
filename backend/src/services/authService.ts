import { hashPin, verifyPin } from '../utils/bcrypt';
import {
  userRepo, restaurantRepo, deviceRepo, subscriptionRepo,
  licenseRepo, refreshTokenRepo, auditLogRepo, branchRepo, employeeRepo,
} from '../repositories';
import {
  generateAccessToken, generateRefreshToken,
  verifyRefreshToken, type AccessTokenPayload,
} from '../utils/jwt';
import { Employee, SubscriptionPlan } from '../models';
import { generatePublicToken } from '../utils/publicToken';
import Payment from '../models/Payment';
import { paymentGateway } from '../modules/payment/RazorpayGateway';
import { isBillingPeriod, billingDurationDays, planPriceForPeriod } from '../modules/subscription/subscriptionService';
import { ALL_FEATURES } from '../constants/planFeatures';
import { config } from '../config';
import { enforceDevicePolicy, assertDeviceNotBlocked } from './devicePolicyService';
import { sessionService } from './sessionService';
import crypto from 'crypto';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  /**
   * Sync lastLogin / lastActivity on the admin-side owner User doc. POS owner
   * logins run through the Restaurant identity (user._id = restaurant._id), so
   * the owner User doc (role 'owner') must be updated explicitly for the Owners
   * dashboard to show real login/activity timestamps.
   */
  private async syncOwnerUserActivity(username: string | undefined, phone: string | undefined, restaurant: any, now: Date): Promise<void> {
    try {
      let ownerUser: any = null;
      if (username) {
        ownerUser = await userRepo.findOne({ userId: username.toLowerCase(), role: 'owner', isDeleted: { $ne: true } } as any);
      }
      if (!ownerUser && restaurant?.ownerUserId) {
        ownerUser = await userRepo.findOne({ userId: restaurant.ownerUserId, role: 'owner', isDeleted: { $ne: true } } as any);
      }
      if (ownerUser) {
        await userRepo.update(ownerUser._id.toString(), { lastLogin: now, lastActivity: now } as any);
      }
    } catch {
      /* non-blocking — activity sync must never fail a login */
    }
  }

  async login(data: {
    restaurantId?: string;
    phone?: string;
    username?: string;
    password: string;
    /** Which credential to verify: 'password' (bcrypt password) or 'pin' (quick PIN). */
    mode?: 'password' | 'pin' | 'role_pin';
    rememberMe?: boolean;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: {
      deviceId?: string;
      deviceName?: string;
      os?: string;
      osVersion?: string;
      appVersion?: string;
    };
  }) {
    let restaurant: any;
    let user: any;
    let employeeForLogin: any;

    if (data.username) {
      restaurant = await restaurantRepo.findOne({ ownerUserId: data.username, isDeleted: { $ne: true } } as any);
      if (restaurant) {
        const isValidRest = await verifyPin(data.password, restaurant.ownerPin);
        if (!isValidRest) throw new Error('Invalid username or password');
        if (!restaurant.isActive) throw new Error('Restaurant is inactive. Contact support.');

        user = {
          _id: restaurant._id,
          toString: () => restaurant._id.toString(),
          name: restaurant.name,
          phone: restaurant.phone,
          email: null,
          role: 'owner',
          status: 'active',
          branchIds: [],
          employeeId: null,
        };
      } else {
        const emp = await employeeRepo.findOne({ username: data.username, isDeleted: { $ne: true } } as any);
        if (emp) {
          if (emp.status !== 'Active') throw new Error('Account is inactive or suspended. Contact your owner.');
          const usePassword = data.mode === 'password' && !!(emp as any).password;
          const isValidEmp = usePassword
            ? await verifyPin(data.password, (emp as any).password)
            : await verifyPin(data.password, emp.pin);
          if (!isValidEmp) throw new Error('Invalid username or password');

          if (!emp.restaurantId) throw new Error('Restaurant not found');
          restaurant = await restaurantRepo.findById(emp.restaurantId.toString());
          if (!restaurant || restaurant.isDeleted) throw new Error('Restaurant not found');
          if (!restaurant.isActive) throw new Error('Restaurant is inactive. Contact support.');

          employeeForLogin = emp;
          user = {
            _id: emp._id,
            toString: () => emp._id.toString(),
            name: emp.name,
            phone: emp.username,
            email: null,
            role: emp.role === 'Owner' ? 'owner' : emp.role?.toLowerCase() || 'owner',
            status: 'active',
            branchIds: emp.branchId ? [emp.branchId] : [],
            employeeId: emp._id,
          };
        } else {
          // Fallback: Check User collection by userId (e.g., super_admin login)
          const usr = await userRepo.findOne({ userId: data.username.toLowerCase(), isDeleted: { $ne: true } } as any);
          if (!usr) throw new Error('Invalid username or password');
          if (usr.status !== 'active') throw new Error('Account is inactive or suspended. Contact support.');
          const isValidUsr = await verifyPin(data.password, usr.password);
          if (!isValidUsr) throw new Error('Invalid username or password');

          // The platform super_admin has no tenant restaurant — resolve only
          // when one exists so a null restaurantId never throws.
          if (usr.restaurantId) {
            restaurant = await restaurantRepo.findById(usr.restaurantId.toString());
            if (!restaurant || restaurant.isDeleted) throw new Error('Restaurant not found');
            if (!restaurant.isActive) throw new Error('Restaurant is inactive. Contact support.');
          }

          user = {
            _id: usr._id,
            toString: () => usr._id.toString(),
            name: usr.name,
            phone: usr.phone,
            email: usr.email || null,
            role: usr.role,
            status: usr.status,
            branchIds: (usr.branchIds || []).map((b: any) => b.toString()),
            employeeId: usr.employeeId?.toString() || null,
          };
        }
      }
    } else {
      restaurant = await restaurantRepo.findOne({ restaurantId: data.restaurantId, isDeleted: { $ne: true } } as any);
      if (!restaurant) throw new Error('Restaurant not found');
      if (!restaurant.isActive) throw new Error('Restaurant is inactive. Contact support.');

      user = await userRepo.findOne({ restaurantId: restaurant._id, phone: data.phone, isDeleted: { $ne: true } } as any);
      if (!user) throw new Error('Invalid phone or password');

      const isValid = await verifyPin(data.password, user.password);
      if (!isValid) throw new Error('Invalid phone or password');
    }

    const now = new Date();
    if (employeeForLogin) {
      await employeeRepo.update(employeeForLogin._id.toString(), { lastLogin: now } as any);
    } else {
      await userRepo.update(user._id.toString(), { lastLogin: now, lastActivity: now } as any);
    }
    // Keep the admin-side owner User doc in sync (owner logins are keyed by
    // the Restaurant identity).
    await this.syncOwnerUserActivity(data.username, data.phone, restaurant, now);

    // Enforce the device policy BEFORE any tokens are minted: blocked devices
    // are rejected and new devices must fit within the plan's maxDevices limit.
    // Running this before token generation means a rejected login never leaks a
    // server-side refresh token (previously the policy ran after refreshToken
    // creation, orphaning a token on every rejected login). Throws
    // DeviceBlockedError (403) or DeviceLimitReachedError (403), which
    // authController maps to responses.
    if (data.deviceInfo?.deviceId) {
      await enforceDevicePolicy({
        userId: user._id.toString(),
        restaurantId: restaurant._id.toString(),
        deviceId: data.deviceInfo.deviceId,
        deviceName: data.deviceInfo.deviceName,
        os: data.deviceInfo.os,
        osVersion: data.deviceInfo.osVersion,
        appVersion: data.deviceInfo.appVersion,
      });
    }

    const tokenPayload: AccessTokenPayload = {
      userId: user._id.toString(),
      restaurantId: restaurant._id.toString(),
      role: user.role,
      name: user.name,
      employeeId: user.employeeId?.toString() || null,
      branchIds: (user.branchIds || []).map((b: any) => b.toString()),
      surface: 'pos', // POS surface — rejected on admin-dashboard routes
    };

    const accessToken = generateAccessToken(tokenPayload, data.rememberMe);
    const refreshTokenId = crypto.randomUUID();
    const refreshToken = generateRefreshToken({ userId: user._id.toString(), tokenId: refreshTokenId }, data.rememberMe);

    const refreshExpiresIn = data.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    // Session metadata is persisted for the session-management layer.
    await refreshTokenRepo.create({
      userId: user._id,
      restaurantId: restaurant._id,
      deviceId: data.deviceInfo?.deviceId || null,
      deviceName: data.deviceInfo?.deviceName || null,
      os: `${data.deviceInfo?.os || ''}${data.deviceInfo?.osVersion ? ` ${data.deviceInfo.osVersion}` : ''}`.trim() || null,
      appVersion: data.deviceInfo?.appVersion || null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshExpiresIn),
      isRevoked: false,
      lastActivityAt: now,
    } as any);

    await auditLogRepo.create({
      action: 'LOGIN',
      entityType: 'user',
      entityId: user._id.toString(),
      performedBy: user.name,
      performedById: user._id.toString(),
      details: { role: user.role, restaurantId: restaurant.restaurantId },
      ipAddress: data.ipAddress || undefined,
    } as any);

    const subscription = await subscriptionRepo.findOne({ restaurantId: restaurant._id } as any);
    const license = await licenseRepo.findOne({ restaurantId: restaurant._id, isActive: true } as any);
    const employee = employeeForLogin || (user.employeeId ? await employeeRepo.findById(user.employeeId.toString()) : null);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user._id.toString(),
        name: user.name,
        phone: user.phone,
        email: user.email || null,
        role: user.role,
        status: user.status,
        branchIds: (user.branchIds || []).map((b: any) => b.toString()),
        employeeId: user.employeeId?.toString() || null,
      },
      restaurant: {
        id: restaurant._id.toString(),
        restaurantId: restaurant.restaurantId,
        name: restaurant.name,
        phone: restaurant.phone,
      },
      employee: employee ? {
        id: employee._id.toString(),
        name: employee.name,
        role: employee.role,
        username: employee.username,
        branchId: employee.branchId?.toString() || null,
        status: employee.status,
      } : null,
      subscription: subscription ? {
        plan: subscription.plan,
        status: subscription.status,
        trialEnd: subscription.trialEnd,
        maxUsers: subscription.maxUsers,
        maxDevices: subscription.maxDevices,
      } : null,
      license: license ? {
        licenseKey: license.licenseKey,
        type: license.type,
        isActive: license.isActive,
      } : null,
    };
  }

  async refresh(refreshToken: string, deviceId?: string) {
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) throw new Error('Invalid or expired refresh token');

    // Compromised-token protection: if this token was already rotated/revoked
    // and is being replayed, revoke the account's other sessions and bail.
    const reused = await sessionService.detectReuse(refreshToken, payload.userId);
    if (reused) throw new Error('Refresh token has been revoked');

    const tokenHash = hashToken(refreshToken);
    const storedToken = await refreshTokenRepo.findOne({ tokenHash, isRevoked: false } as any);
    if (!storedToken) throw new Error('Refresh token has been revoked');

    if (new Date() > storedToken.expiresAt) {
      await refreshTokenRepo.update(storedToken._id.toString(), { isRevoked: true } as any);
      throw new Error('Refresh token has expired');
    }

    // A blocked device cannot extend its session — the terminal must re-login
    // (where the full device policy runs again).
    await assertDeviceNotBlocked(payload.userId, deviceId);

    await refreshTokenRepo.update(storedToken._id.toString(), { isRevoked: true } as any);

    let user: any = await userRepo.findById(payload.userId);
    let restaurant: any;
    let isEmployeeLogin = false;
    let isRestaurantLogin = false;

    if (user && !user.isDeleted && user.status === 'active') {
      // Platform super_admin has no tenant restaurant (restaurantId null).
      if (user.restaurantId) {
        restaurant = await restaurantRepo.findById(user.restaurantId.toString());
      }
    } else {
      const emp = await employeeRepo.findById(payload.userId);
      if (emp && !emp.isDeleted && emp.status === 'Active' && emp.restaurantId) {
        restaurant = await restaurantRepo.findById(emp.restaurantId.toString());
        user = emp;
        isEmployeeLogin = true;
      } else {
        restaurant = await restaurantRepo.findById(payload.userId);
        if (!restaurant || restaurant.isDeleted) throw new Error('User not found');
        // Restaurant-identity login: the JWT userId is the restaurant _id and
        // there is no separate User doc — treat the restaurant as the user so
        // the new refresh-token row below (userId: user._id) is minted against
        // the same identity. Previously `user` stayed null here and
        // user._id.toString() threw → POST /auth/refresh always 500'd for
        // owner logins, breaking the frontend's 401 self-heal (empty POS).
        user = restaurant;
        isRestaurantLogin = true;
      }
    }

    if (!restaurant || !restaurant.isActive) throw new Error('Restaurant is inactive');

    const tokenPayload: AccessTokenPayload = {
      userId: payload.userId,
      restaurantId: restaurant._id.toString(),
      role: isRestaurantLogin ? 'owner' : (isEmployeeLogin ? (user.role === 'Owner' ? 'owner' : user.role?.toLowerCase() || 'owner') : user.role),
      name: isRestaurantLogin ? restaurant.name : user.name,
      employeeId: isRestaurantLogin ? null : (isEmployeeLogin ? user._id.toString() : user.employeeId?.toString() || null),
      branchIds: isRestaurantLogin ? [] : (isEmployeeLogin ? (user.branchId ? [user.branchId.toString()] : []) : (user.branchIds || []).map((b: any) => b.toString())),
      surface: 'pos', // POS surface — rejected on admin-dashboard routes
    };

    const rememberMe = storedToken.expiresAt.getTime() - Date.now() > 14 * 24 * 60 * 60 * 1000;
    const newAccessToken = generateAccessToken(tokenPayload, rememberMe);
    const newRefreshTokenId = crypto.randomUUID();
    const newRefreshToken = generateRefreshToken({ userId: user._id.toString(), tokenId: newRefreshTokenId }, rememberMe);

    const refreshExpiresIn = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    await refreshTokenRepo.create({
      userId: user._id,
      restaurantId: restaurant._id,
      deviceId: storedToken.deviceId || null,
      deviceName: storedToken.deviceName || null,
      os: storedToken.os || null,
      appVersion: storedToken.appVersion || null,
      ipAddress: storedToken.ipAddress || null,
      userAgent: storedToken.userAgent || null,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + refreshExpiresIn),
      isRevoked: false,
      lastActivityAt: new Date(),
    } as any);

    // Keep owner activity fresh on token refresh.
    try {
      if (restaurant?.ownerUserId) {
        const ownerUser = await userRepo.findOne({ userId: restaurant.ownerUserId, role: 'owner', isDeleted: { $ne: true } } as any);
        if (ownerUser) {
          await userRepo.update(ownerUser._id.toString(), { lastActivity: new Date() } as any);
        }
      }
    } catch { /* non-blocking */ }

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      const stored = await refreshTokenRepo.findOne({ tokenHash, userId: userId as any } as any);
      if (stored) {
        await refreshTokenRepo.update(stored._id.toString(), { isRevoked: true } as any);
      }
    }
  }

  async logoutAll(userId: string) {
    await refreshTokenRepo.updateMany({ userId: userId as any, isRevoked: false } as any, { isRevoked: true } as any);
    await deviceRepo.updateMany({ userId: userId as any } as any, { isActive: false } as any);
  }

  async ownerExists(): Promise<boolean> {
    const count = await Employee.countDocuments({ role: 'Owner', isDeleted: { $ne: true } }).limit(1).exec();
    return count > 0;
  }

  /**
   * Generate a unique staff User ID + a secure random password (bcrypt-hashed)
   * so the Owner (or admin) never has to invent credentials. The returned
   * userId/password must be handed to the staff member; only the hash is stored.
   * Used by the POS "Generate credentials" action and by admin provisioning.
   */
  async generateStaffCredentials(name: string, role: 'Owner' | 'Manager' | 'Cashier' = 'Cashier', avoid?: string[]) {
    const base = (name || role || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20) || 'staff';
    const prefix = base;
    const blacklist = new Set((avoid || []).map((u: string) => u.toLowerCase()));

    // Unique username — retry on collision with an incrementing suffix count.
    let userId = `${prefix}_${Math.random().toString(36).slice(2, 6)}`;
    let attempts = 0;
    while ((await employeeRepo.findOne({ username: userId as any } as any)) || blacklist.has(userId)) {
      attempts += 1;
      userId = `${prefix}_${Math.random().toString(36).slice(2, 6)}${attempts}`;
      if (attempts > 20) break;
    }

    // 8-char alphanumeric password (no ambiguous characters).
    const password = Array.from({ length: 8 }, () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      return chars.charAt(crypto.randomInt(chars.length));
    }).join('');

    const passwordHash = await hashPin(password);

    return { userId, password, passwordHash, role };
  }

  async registerOwner(data: {
    fullName: string;
    phone: string;
    email?: string;
    password: string;
    restaurantName: string;
    userId?: string;
    planId?: string;
    paymentOrderId?: string;
    paymentId?: string;
    paymentSignature?: string;
  }) {
    const existingOwner = await Employee.findOne({ role: 'Owner', isDeleted: { $ne: true } }).exec();
    if (existingOwner) {
      throw new Error('Owner account already exists. Only one Owner can be registered.');
    }

    // Owner-chosen login id (legacy clients keep the phone as the login id).
    const username = (data.userId || '').trim() || data.phone;
    if (data.userId) {
      const existingUser = await userRepo.findOne({ userId: username, role: 'owner', isDeleted: { $ne: true } } as any);
      if (existingUser) throw new Error('That User ID is already taken. Please choose another.');
    }

    // ── Paid onboarding: validate the plan + verify payment BEFORE creating any
    //    entity, so a failed/forged payment never leaves partial data behind. ──
    let plan: any = null;
    let payment: any = null;
    if (data.planId) {
      plan = await SubscriptionPlan.findOne({ planId: data.planId, isActive: true }).lean().exec();
      if (!plan) throw new Error('Selected plan not found or inactive');
      payment = await Payment.findOne({ razorpayOrderId: data.paymentOrderId }).exec();
      if (!payment) throw new Error('Payment record not found — complete the payment first');
      if (payment.status === 'success' && payment.restaurantId) {
        throw new Error('This payment has already been used for another registration');
      }
      if (config.razorpay.keySecret) {
        if (!data.paymentSignature) throw new Error('Payment signature is required');
        const valid = paymentGateway.verifySignature({
          orderId: data.paymentOrderId as string,
          paymentId: data.paymentId as string,
          signature: data.paymentSignature,
        });
        if (!valid) throw new Error('Invalid payment signature — possible tampering detected');
      } else {
        console.warn('[AuthService] registerOwner: RAZORPAY_KEY_SECRET not set — dev-mode payment accepted');
      }
    }

    // Transactional onboarding: every entity must be created together. The repo
    // layer doesn't pass mongoose sessions, so we use compensating rollback —
    // if any step fails we hard-delete everything created so far (reverse
    // order) so no partial restaurant/owner data is ever left behind.
    let restaurant: any = null;
    let branch: any = null;
    let employee: any = null;
    let user: any = null;
    let subscription: any = null;

    try {
      restaurant = await restaurantRepo.create({
        restaurantId: data.restaurantName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 20),
        name: data.restaurantName,
        phone: data.phone,
        isActive: true,
        ownerUserId: username,
        // Public storefront capability — without it QR Studio can never mint
        // table/car/pickup stickers (resolvePublicToken returns null and every
        // sticker create/seed fails with "No public store token configured").
        // The admin onboarding path sets this; POS first-time setup must too.
        publicToken: generatePublicToken(),
      } as any);

      branch = await branchRepo.create({
        name: data.restaurantName,
        phone: data.phone,
        isHeadBranch: true,
        isActive: true,
        restaurantId: restaurant._id,
      } as any);

      const hashedPassword = await hashPin(data.password);

      // Keep the POS owner login (Restaurant.ownerPin) in sync with the same
      // credentials — the login path resolves the restaurant by ownerUserId and
      // verifies ownerPin, so the owner's chosen User ID + Password must work.
      await restaurantRepo.update(restaurant._id as any, { ownerPin: hashedPassword } as any);

      employee = await employeeRepo.create({
        username,
        name: data.fullName,
        role: 'Owner',
        pin: hashedPassword,
        status: 'Active',
        branchId: branch._id,
        restaurantId: restaurant._id,
      } as any);

      user = await userRepo.create({
        userId: username,
        restaurantId: restaurant._id,
        phone: data.phone,
        name: data.fullName,
        email: data.email || null,
        password: hashedPassword,
        role: 'owner',
        status: 'active',
        employeeId: employee._id,
        branchIds: [branch._id],
      } as any);

      // Paid plan (payment verified above) or free trial — never both.
      // The subscription inherits the billing cadence the owner paid for.
      const paidPeriod = isBillingPeriod(payment?.billingPeriod) ? payment.billingPeriod : 'monthly';
      subscription = plan
        ? await subscriptionRepo.create({
            restaurantId: restaurant._id,
            plan: plan.planId,
            status: 'active',
            billingPeriod: paidPeriod,
            startDate: new Date(),
            expiryDate: new Date(Date.now() + billingDurationDays(paidPeriod) * 24 * 60 * 60 * 1000),
            maxUsers: plan.maxUsers || 5,
            maxDevices: (plan.limits?.maxDevicesPerBranch ?? plan.limits?.maxDevices ?? plan.maxDevices) || 3,
            limits: {
              maxBranches: plan.limits?.maxBranches ?? 1,
              maxDevicesPerBranch: plan.limits?.maxDevicesPerBranch ?? plan.limits?.maxDevices ?? 3,
            },
            features: Array.isArray(plan.features) && plan.features.length > 0
              ? plan.features
              : ['core_pos', 'basic_reports', 'inventory', 'loyalty'],
            ...(plan.aiEnabled !== undefined ? { aiEnabled: plan.aiEnabled } : {}),
          } as any)
        : await subscriptionRepo.create({
            restaurantId: restaurant._id,
            plan: 'free',
            status: 'trial',
            startDate: new Date(),
            trialStart: new Date(),
            trialEnd: new Date(Date.now() + config.subscription.trialDays * 24 * 60 * 60 * 1000),
            // Keep expiryDate in lockstep with trialEnd — the schema's 7-day
            // default would otherwise leave a misleading earlier date that
            // status payloads and proration read.
            expiryDate: new Date(Date.now() + config.subscription.trialDays * 24 * 60 * 60 * 1000),
            maxUsers: 5,
            maxDevices: 6,
            // Trial grants the FULL product — every feature in the catalog
            // (single source: constants/planFeatures). Never a partial list.
            features: ALL_FEATURES,
          } as any);

      // Claim the pre-registration payment onto the new tenant.
      if (plan && payment) {
        await Payment.updateOne(
          { _id: payment._id },
          {
            $set: {
              restaurantId: restaurant._id,
              subscriptionId: subscription?._id,
              razorpayPaymentId: data.paymentId,
              signature: data.paymentSignature || null,
              status: 'success',
              paymentMethod: 'razorpay',
            },
          }
        ).exec();
      }
    } catch (error) {
      // Compensating rollback — remove any partially-created records.
      const rollbackSteps: Array<[any, string]> = [];
      if (subscription) rollbackSteps.push([subscriptionRepo, subscription._id.toString()]);
      if (user) rollbackSteps.push([userRepo, user._id.toString()]);
      if (employee) rollbackSteps.push([employeeRepo, employee._id.toString()]);
      if (branch) rollbackSteps.push([branchRepo, branch._id.toString()]);
      if (restaurant) rollbackSteps.push([restaurantRepo, restaurant._id.toString()]);
      for (const [repo, id] of rollbackSteps) {
        try { await repo.hardDelete(id); } catch { /* best-effort cleanup */ }
      }
      console.error('[AuthService] registerOwner failed — rolled back partial creation:', error);
      throw error;
    }

    const accessToken = generateAccessToken({
      userId: user._id.toString(),
      restaurantId: restaurant._id.toString(),
      role: 'owner',
      name: user.name,
      employeeId: employee._id.toString(),
      branchIds: [branch._id.toString()],
      surface: 'pos', // POS surface — rejected on admin-dashboard routes
    });

    await auditLogRepo.create({
      action: 'OWNER_REGISTER',
      entityType: 'user',
      entityId: user._id.toString(),
      performedBy: user.name,
      performedById: user._id.toString(),
      details: {
        restaurantName: data.restaurantName,
        branchId: branch._id.toString(),
        onboarding: plan ? 'paid' : 'trial',
        planId: plan ? plan.planId : undefined,
      },
    } as any);

    return {
      accessToken,
      user: {
        id: user._id.toString(),
        name: user.name,
        phone: user.phone,
        role: 'owner',
        branchIds: [branch._id.toString()],
        employeeId: employee._id.toString(),
      },
      employee: {
        id: employee._id.toString(),
        name: employee.name,
        role: 'Owner',
        username: employee.username,
        branchId: branch._id.toString(),
        status: 'Active',
      },
      restaurant: {
        id: restaurant._id.toString(),
        restaurantId: restaurant.restaurantId,
        name: restaurant.name,
      },
    };
  }

  /**
   * Create a payment order for plan purchase BEFORE the owner account exists.
   * The resulting Payment row has no restaurantId yet; registerOwner() claims
   * it once payment is confirmed. Returns the Razorpay order + key so the POS
   * can render the checkout. In dev mode (no keys) the gateway returns a mock
   * order and the flow completes with the dev-mode payment path.
   */
  async createRegisterOrder(planId?: string, billingPeriod?: string) {
    const plan = await SubscriptionPlan.findOne({ planId, isActive: true }).lean().exec()
      || await SubscriptionPlan.findOne({ isDefault: true, isActive: true }).lean().exec();
    if (!plan) throw new Error('No subscription plan found');

    const period = isBillingPeriod(billingPeriod) ? billingPeriod : 'monthly';
    const periodPrice = planPriceForPeriod(plan, period);
    const amount = periodPrice * 100; // paise
    const receipt = `reg_${crypto.randomBytes(8).toString('hex')}`;
    const order = await paymentGateway.createOrder({
      amount,
      currency: 'INR',
      receipt,
      notes: { planId: plan.planId, billingPeriod: period, purpose: 'owner_registration' },
    });

    const invoiceNumber = `REG-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await Payment.create({
      restaurantId: null,
      razorpayOrderId: order.id,
      amount: periodPrice,
      currency: 'INR',
      gateway: 'razorpay',
      paymentMethod: 'razorpay',
      billingPeriod: period,
      status: 'created',
      invoiceNumber,
    } as any);

    console.log(`[AuthService] Registration order created: ${order.id}, amount: ${amount}, period: ${period}`);

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: paymentGateway.getKeyId(),
      invoiceNumber,
      billingPeriod: period,
      plan: { planId: plan.planId, name: plan.name, price: periodPrice, billingPeriod: period },
    };
  }
}
