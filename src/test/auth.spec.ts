// @ts-nocheck

import jwt from "jsonwebtoken";
import AppDataSource from "../data-source";
import { Conflict, HttpError, ResourceNotFound } from "../middleware";
import { User } from "../models";
import { AuthService } from "../services";
import {} from "../services/auth.services";
import {
  comparePassword,
  generateAccessToken,
  generateNumericOTP,
  generateToken,
  hashPassword,
  verifyToken,
} from "../utils";
import { Sendmail } from "../utils/mail";

jest.mock("../data-source", () => {
  return {
    AppDataSource: {
      manager: {},
      initialize: jest.fn().mockResolvedValue(true),
    },
  };
});
jest.mock("../models");
jest.mock("../utils");
jest.mock("../utils/mail");
jest.mock("jsonwebtoken");

describe("AuthService", () => {
  let authService: AuthService;
  let userRepositoryMock: jest.Mocked<Repository<User>>;
  let profilesRepositoryMock: Repository<Profile>;
  let userServiceMock: jest.Mocked<UserService>;

  beforeEach(() => {
    userRepositoryMock = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as any;

    profilesRepositoryMock = {
      save: jest.fn(),
    } as unknown as Repository<Profile>;
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === User) return userRepositoryMock;
      if (entity === Profile) return profilesRepositoryMock;
      return {};
    });

    userServiceMock = {
      getUserById: jest.fn(),
      updateUserRecord: jest.fn(),
      compareUserPassword: jest.fn(),
      getUserByEmail: jest.fn(),
    } as any;
    authService = new AuthService();
    (authService as any).userService = userServiceMock;
    (speakeasy.generateSecret as jest.Mock).mockReturnValue({
      base32: "TESTSECRET",
      ascii: "TESTASCII",
    });
    (speakeasy.otpauthURL as jest.Mock).mockReturnValue(
      "http://test-qr-code-url",
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("signUp", () => {
    it("should sign up a new user", async () => {
      const payload = {
        first_name: "John",
        last_name: "Doe",
        email: "john.doe@example.com",
        password: "password123",
        phone_number: "1234567890",
      };

      const hashedPassword = "hashedPassword";
      const otp = "123456";
      const message = "user created";
      const createdUser = {
        id: 1,
        name: "John Doe",
        email: "john.doe@example.com",
        password: hashedPassword,
        profile: {
          phone_number: "1234567890",
          first_name: "John",
          last_name: "Doe",
          avatarUrl: "",
        },
        otp: parseInt(otp),
        otp_expires_at: new Date(Date.now() + 10 * 60 * 1000),
      };
      const token = "access_token";

      (User.findOne as jest.Mock).mockResolvedValue(null);
      (hashPassword as jest.Mock).mockResolvedValue(hashedPassword);
      (generateNumericOTP as jest.Mock).mockReturnValue(otp);
      mockManager.save.mockResolvedValue(createdUser);
      (jwt.sign as jest.Mock).mockReturnValue(token);

      const result = await authService.signUp(payload);

      expect(result).toEqual({
        message,
        user: {
          id: 1,
          name: "John Doe",
          email: "john.doe@example.com",
          profile: {
            phone_number: "1234567890",
            first_name: "John",
            last_name: "Doe",
            avatarUrl: "",
          },
        },
        access_token: token,
      });
    });

    it("should throw a Conflict error if the user already exists", async () => {
      const payload = {
        first_name: "John",
        last_name: "Doe",
        email: "john.doe@example.com",
        password: "password123",
        phone: "1234567890",
      };

      (User.findOne as jest.Mock).mockResolvedValue({});

      await expect(authService.signUp(payload)).rejects.toThrow(Conflict);
    });
  });

  describe("verifyEmail", () => {
    it("should verify email with correct OTP", async () => {
      const token = "validToken";
      const otp = 123456;
      const user = {
        id: 1,
        email: "john.doe@example.com",
        otp,
        otp_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        isverified: false,
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 1 });
      (User.findOne as jest.Mock).mockResolvedValue(user);
      mockManager.save.mockResolvedValue(user);

      const result = await authService.verifyEmail(token, otp);

      expect(result).toEqual({ message: "Email successfully verified" });
    });

    it("should throw an error for invalid OTP", async () => {
      const token = "validToken";
      const otp = 123456;
      const user = {
        id: 1,
        email: "john.doe@example.com",
        otp: 654321,
        otp_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        isverified: false,
      };

      (jwt.verify as jest.Mock).mockReturnValue({ userId: 1 });
      (User.findOne as jest.Mock).mockResolvedValue(user);

      await expect(authService.verifyEmail(token, otp)).rejects.toThrow(
        HttpError,
      );
    });
  });

  describe("login", () => {
    it("should login user with correct credentials", async () => {
      const payload = {
        email: "john.doe@example.com",
        password: "password123",
      };

      const user = {
        id: 1,
        email: "john.doe@example.com",
        password: "hashedPassword",
        isverified: true,
      };

      const token = "access_token";

      (User.findOne as jest.Mock).mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(true);
      (jwt.sign as jest.Mock).mockReturnValue(token);

      const result = await authService.login(payload);

      expect(result).toEqual({
        access_token: token,
        user: {
          id: 1,
          email: "john.doe@example.com",
          isverified: true,
        },
      });
    });

    it("should throw an error for incorrect credentials", async () => {
      const payload = {
        email: "john.doe@example.com",
        password: "wrongPassword",
      };

      const user = {
        id: 1,
        email: "john.doe@example.com",
        password: "hashedPassword",
        isverified: true,
      };

      (User.findOne as jest.Mock).mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(false);

      await expect(authService.login(payload)).rejects.toThrow(HttpError);
    });
  });

  describe("changePassword", () => {
    it("should change password successfully with correct old password", async () => {
      const userId = 1;
      const oldPassword = "oldPassword123";
      const newPassword = "newPassword123";
      const confirmPassword = "newPassword123";

      const user = {
        id: userId,
        password: "hashedOldPassword", // Hashed version of oldPassword
      };

      const hashedNewPassword = "hashedNewPassword";

      (User.findOne as jest.Mock).mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(true);
      (hashPassword as jest.Mock).mockResolvedValue(hashedNewPassword);
      mockManager.save.mockResolvedValue({
        ...user,
        password: hashedNewPassword,
      });

      const result = await authService.changePassword(
        userId,
        oldPassword,
        newPassword,
        confirmPassword,
      );

      expect(result).toEqual({ message: "Password changed successfully" }); // Updated to match actual result
    });

    it("should throw an error if old password is incorrect", async () => {
      const userId = 1;
      const oldPassword = "wrongOldPassword";
      const newPassword = "newPassword123";
      const confirmPassword = "newPassword123";

      const user = {
        id: userId,
        password: "hashedOldPassword",
      };

      (User.findOne as jest.Mock).mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.changePassword(
          userId,
          oldPassword,
          newPassword,
          confirmPassword,
        ),
      ).rejects.toThrow(HttpError);
    });

    it("should throw an error if new password and confirm password do not match", async () => {
      const userId = 1;
      const oldPassword = "oldPassword123";
      const newPassword = "newPassword123";
      const confirmPassword = "differentPassword123";

      const user = {
        id: userId,
        password: "hashedOldPassword",
      };

      (User.findOne as jest.Mock).mockResolvedValue(user);
      (comparePassword as jest.Mock).mockResolvedValue(true);

      await expect(
        authService.changePassword(
          userId,
          oldPassword,
          newPassword,
          confirmPassword,
        ),
      ).rejects.toThrow(HttpError);
    });
  });

  describe("magicLink Auth", () => {
    it("should throw ResourceNotFound for non-existent user", async () => {
      const payload = {
        email: "nonexistent@example.com",
      };

      (User.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        authService.generateMagicLink(payload.email),
      ).rejects.toThrow(ResourceNotFound);

      await expect(
        authService.generateMagicLink(payload.email),
      ).rejects.toThrow("User is not registered");

      expect(User.findOne).toHaveBeenCalledWith({
        where: { email: payload.email },
      });
    });

    it("should generate magic link for existing user", async () => {
      const payload = {
        email: "existing@example.com",
      };

      const mockUser = { id: "1", email: payload.email };
      const token = "a-authtoken";
      const mailSent = "Email sent successfully.";

      // Mock successful responses
      (User.findOne as jest.Mock).mockResolvedValue(mockUser);
      (generateToken as jest.Mock).mockReturnValue(token);
      (Sendmail as jest.Mock).mockResolvedValue(mailSent);

      const result = await authService.generateMagicLink(payload.email);

      expect(result).toEqual({
        ok: true,
        message: "Email sent successfully.",
        user: mockUser,
      });

      expect(User.findOne).toHaveBeenCalledWith({
        where: { email: payload.email },
      });
      expect(generateToken).toHaveBeenCalledWith({ email: payload.email });
      expect(Sendmail).toHaveBeenCalled();
    });

    it("should validate the token and return user information", async () => {
      const token = "valid-token";
      const email = "test@example.com";
      const mockUser = { id: "1", email };

      (verifyToken as jest.Mock).mockReturnValue({ email });
      (User.findOne as jest.Mock).mockResolvedValue(mockUser);

      const result = await authService.validateMagicLinkToken(token);

      expect(result).toEqual({
        status: "ok",
        email: mockUser.email,
        userId: mockUser.id,
      });
    });

    it("should throw an error for invalid token", async () => {
      const token = "invalid-token";
      (verifyToken as jest.Mock).mockReturnValue({});

      await expect(authService.validateMagicLinkToken(token)).rejects.toThrow(
        "Invalid JWT",
      );
    });

    it("should generate an access token for a valid user ID", async () => {
      const userId = "1";
      const mockAccessToken = "mock-access-token";

      (generateAccessToken as jest.Mock).mockResolvedValue(mockAccessToken);

      const result = await authService.passwordlessLogin(userId);

      expect(result).toEqual({ access_token: mockAccessToken });
    });
  });

  describe("AuthService-enable2FA", () => {
    it("should enable 2FA successfully", async () => {
      const mockUser = {
        id: "user123",
        email: "test@example.com",
        password: "hashedPassword123",
        is_2fa_enabled: false,
      };
      userServiceMock.getUserById.mockResolvedValue(mockUser as unknown as any);
      userServiceMock.compareUserPassword.mockResolvedValue(true);
      userServiceMock.updateUserRecord.mockResolvedValue(undefined);

      const speakeasySecretSpy = jest
        .spyOn(speakeasy, "generateSecret")
        .mockReturnValue({
          base32: "mockSecret",
          ascii: "mockAsciiSecret",
        } as unknown as any);
      const speakeasyOtpauthURLSpy = jest
        .spyOn(speakeasy, "otpauthURL")
        .mockReturnValue("mockQRCodeUrl");

      const result = await authService.enable2FA("user123", "password123");
      expect(userServiceMock.getUserById).toHaveBeenCalledWith("user123");
      expect(userServiceMock.compareUserPassword).toHaveBeenCalledWith(
        "password123",
        "hashedPassword123",
      );
      expect(userServiceMock.updateUserRecord).toHaveBeenCalledWith({
        updatePayload: expect.objectContaining({
          secret: "mockSecret",
          is_2fa_enabled: true,
          backup_codes: expect.any(Array),
        }),
        identifierOption: {
          identifier: "user123",
          identifierType: "id",
        },
      });
      expect(result).toEqual({
        message: "2FA setup initiated",
        data: {
          secret: "mockSecret",
          qr_code_url: "mockQRCodeUrl",
          backup_codes: expect.any(Array),
        },
      });
      expect(speakeasySecretSpy).toHaveBeenCalledWith({ length: 32 });
      expect(speakeasyOtpauthURLSpy).toHaveBeenCalledWith({
        secret: "mockAsciiSecret",
        label: `Hng:test@example.com`,
        issuer: `Hng Boilerplate`,
      });
    });

    it("should throw BadRequest if password is invalid", async () => {
      const mockUser = {
        id: "user123",
        password: "hashedPassword",
        is_2fa_enabled: false,
      };
      userServiceMock.getUserById.mockResolvedValue(mockUser as unknown as any);
      await expect(
        authService.enable2FA("user123", "wrongpassword"),
      ).rejects.toThrow(BadRequest);
      expect(userServiceMock.updateUserRecord).not.toHaveBeenCalled();
    });

    it("should throw BadRequest if 2FA is already enabled", async () => {
      const mockUser = {
        id: "user123",
        password: "hashedPassword",
        is_2fa_enabled: true,
      };
      userServiceMock.getUserById.mockResolvedValue(mockUser as unknown as any);

      await expect(
        authService.enable2FA("user123", "password123"),
      ).rejects.toThrow(BadRequest);
      expect(userServiceMock.updateUserRecord).not.toHaveBeenCalled();
    });

    it("should throw ServerError for unexpected errors", async () => {
      userServiceMock.getUserById.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(
        authService.enable2FA("user123", "password123"),
      ).rejects.toThrow(ServerError);
    });
  });
});
