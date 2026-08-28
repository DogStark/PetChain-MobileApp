import { type DataLoaders } from './dataLoaders';
import { type UserRole } from '../../models/UserRole';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface GraphQLContext {
  user: AuthUser | null;
  loaders: DataLoaders;
}
