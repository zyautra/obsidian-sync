import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { VaultService } from './vault.service';

@Controller('vaults')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get()
  async getAllVaults() {
    return await this.vaultService.getAllVaults();
  }

  @Get(':id')
  async getVault(@Param('id') id: string) {
    return await this.vaultService.getVaultById(id);
  }

  @Get(':id/devices')
  async getVaultDevices(@Param('id') id: string) {
    return await this.vaultService.getVaultDevices(id);
  }

  @Get(':id/files')
  async getVaultFiles(@Param('id') id: string) {
    return await this.vaultService.getVaultFiles(id);
  }

  @Get(':id/locks')
  async getActiveLocks(@Param('id') id: string) {
    return await this.vaultService.getActiveLocks(id);
  }

  @Post()
  async createVault(@Body() data: { name: string }) {
    return await this.vaultService.createVault(data.name);
  }

  @Delete(':id')
  async deleteVault(@Param('id') id: string) {
    return await this.vaultService.deleteVault(id);
  }

  @Post(':id/cleanup-locks')
  async cleanupExpiredLocks(@Param('id') id: string) {
    return await this.vaultService.cleanupExpiredLocks(id);
  }
}