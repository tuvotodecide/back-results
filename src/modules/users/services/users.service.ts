import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async findByDni(dni: string): Promise<UserDocument> {
    const user = await this.userModel.findOne({ dni }).exec();
    if (!user) {
      throw new NotFoundException(`Usuario con DNI ${dni} no encontrado`);
    }
    return user;
  }

  async findOrCreateByDni(dni: string): Promise<UserDocument> {
    try {
      const user = await this.userModel
        .findOneAndUpdate(
          { dni },
          { $setOnInsert: { dni, active: true } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .orFail()
        .exec();

      return user as UserDocument;
    } catch (e: any) {

      if (e?.code === 11000) {
        return this.userModel.findOne({ dni }).orFail().exec();
      }
      throw e;
    }
  }
}
