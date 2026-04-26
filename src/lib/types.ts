export type UserType = "rider" | "driver";
export type VehicleType = "bike" | "car" | "cng";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  type: UserType;
  vehicleType: VehicleType | null;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface LocationPayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
}

export interface LiveLocation {
  userId: string;
  name: string;
  email: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  updatedAt: string;
}
