import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RoledUser, RoledUserDocument } from '../schemas/roledUser.schema';
import { RegisterRoledUserDto } from '../dto/register-roled-user.dto';
import bcrypt from 'bcrypt';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';
import { SignInDto, SignInResponseDto } from '../dto/sign-in.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(RoledUser.name) private roledUserModel: Model<RoledUserDocument>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    @InjectModel(Municipality.name) private municipalityModel: Model<Municipality>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterRoledUserDto): Promise<RoledUserDocument> {
    if ((!dto.votingDepartmentId && !dto.votingMunicipalityId) || (dto.votingDepartmentId && dto.votingMunicipalityId)) {
      throw new BadRequestException(
        'Debe proporcionar un ID de departamento o municipio de votación',
      );
    }

    if (
      dto.votingDepartmentId &&
      !(await this.departmentModel.exists({ _id: dto.votingDepartmentId }))
    ) {
      throw new BadRequestException('El departamento de votación proporcionado no existe');
    }

    if (
      dto.votingMunicipalityId &&
      !(await this.municipalityModel.exists({ _id: dto.votingMunicipalityId }))
    ) {
      throw new BadRequestException('El municipio de votación proporcionado no existe');
    }

    const payload: Partial<RoledUser> = {
      dni: dto.dni,
      email: dto.email,
      name: dto.name,
      password: bcrypt.hashSync(dto.password, 10),
      role: dto.votingDepartmentId ? 'GOVERNOR' : 'MAYOR',
      votingDepartmentId: dto.votingDepartmentId
        ? new Types.ObjectId(dto.votingDepartmentId)
        : null,
      votingMunicipalityId: dto.votingMunicipalityId
        ? new Types.ObjectId(dto.votingMunicipalityId)
        : null,
      active: false,
    };

    try {
      const user = await this.roledUserModel.create(payload);
      return user;
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new BadRequestException('Usuario ya registrado para el DNI o correo electrónico proporcionado');
      }
      throw error;
    }
  }

  async signIn(dto: SignInDto): Promise<SignInResponseDto> {
    const user = await this.roledUserModel.findOne({ email: dto.email });
    if (!user) {
      throw new ForbiddenException('Credenciales inválidas');
    }

    if (!user.active) {
      throw new UnauthorizedException('El usuario no está activo');
    }

    const passwordMatches = bcrypt.compareSync(dto.password, user.password);
    if (!passwordMatches) {
      throw new ForbiddenException('Credenciales inválidas');
    }

    const payload = {
      sub: user._id.toString(),
      dni: user.dni,
      role: user.role,
      active: user.active,
    };

    if (user.votingDepartmentId) {
      payload['votingDepartmentId'] = user.votingDepartmentId.toString();
    }
    
    if (user.votingMunicipalityId) {
      payload['votingMunicipalityId'] = user.votingMunicipalityId.toString();
    }
    
    const accessToken = await this.jwtService.signAsync(payload);

    return { accessToken, role: user.role, active: user.active };
  }
}
