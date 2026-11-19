import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { loginSchema } from '@/lib/validations';
import { checkLoginRateLimit, recordFailedLogin, resetFailedLogin } from '@/lib/rateLimit';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

const GENERIC_AUTH_ERROR = 'Invalid ID or password';

function logLoginFailure(reason: 'no_such_user' | 'wrong_password' | 'inactive_team' | 'validation_failed') {
  console.warn(reason);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      logLoginFailure('validation_failed');
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 400 });
    }

    const { identifier, password } = parsed.data;
    const trimmedId = identifier.toLowerCase();

    // Client IP for rate limiting
    const forwardedFor = req.headers.get('x-forwarded-for');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : 'local';
    const rateLimitKey = `${trimmedId}:${ip}`;

    const rateCheck = checkLoginRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please wait ${Math.ceil(
            rateCheck.retryAfterSec / 60
          )} minutes before trying again.`,
        },
        { status: 429 }
      );
    }

    // 1. Check Admin
    const admin = await prisma.admin.findFirst({
      where: { email: trimmedId },
    });

    if (admin) {
      const isMatch = await bcrypt.compare(password, admin.password_hash);
      if (!isMatch) {
        logLoginFailure('wrong_password');
        recordFailedLogin(rateLimitKey);
        return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
      }

      resetFailedLogin(rateLimitKey);

      const token = await createSessionToken({
        role: 'admin',
        adminId: admin.id,
        email: admin.email,
        name: admin.name,
      });

      const response = NextResponse.json({
        success: true,
        role: 'admin',
        redirect: '/admin',
      });

      setSessionCookie(response, token);
      return response;
    }

    // 2. Check Team (login_id or exact name)
    const team = await prisma.team.findFirst({
      where: {
        OR: [
          { login_id: trimmedId },
          { name: { equals: identifier, mode: 'insensitive' } },
        ],
      },
    });

    if (team) {
      if (!team.active) {
        // Return generic error to avoid leaking account status
        logLoginFailure('inactive_team');
        recordFailedLogin(rateLimitKey);
        return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
      }

      const isMatch = await bcrypt.compare(password, team.password_hash);
      if (!isMatch) {
        logLoginFailure('wrong_password');
        recordFailedLogin(rateLimitKey);
        return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
      }

      resetFailedLogin(rateLimitKey);

      const token = await createSessionToken({
        role: 'team',
        teamId: team.id,
        loginId: team.login_id,
        name: team.name,
      });

      const response = NextResponse.json({
        success: true,
        role: 'team',
        redirect: '/dashboard',
      });

      setSessionCookie(response, token);
      return response;
    }

    // User or Team does not exist
    logLoginFailure('no_such_user');
    recordFailedLogin(rateLimitKey);
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  } catch {
    return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 500 });
  }
}
