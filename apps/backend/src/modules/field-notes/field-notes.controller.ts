import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FieldNotesService } from './field-notes.service';

class NoteGeoDto {
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @IsNumber()
  @IsLongitude()
  lng!: number;
}

class NoteBody {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(20_000) body?: string;
  @IsOptional() @IsString() @MaxLength(120) village?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => NoteGeoDto)
  geo?: NoteGeoDto;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('health_worker')
@Controller('field-notes')
export class FieldNotesController {
  constructor(private readonly notesService: FieldNotesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notesService.list(user.workerId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: NoteBody) {
    return this.notesService.create(user.workerId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: NoteBody,
  ) {
    return this.notesService.update(user.workerId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notesService.remove(user.workerId, id);
  }
}
