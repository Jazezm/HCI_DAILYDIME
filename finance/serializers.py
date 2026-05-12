from rest_framework import serializers  # type: ignore
from .models import Transaction, Budget, Profile, Category, Account, Goal
from django.contrib.auth.models import User  # type: ignore

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email']


class ProfileSerializer(serializers.ModelSerializer):
    avatar = serializers.ImageField(required=False, allow_null=True)
    class Meta:
        model = Profile
        fields = ['phone', 'address', 'date_of_birth', 'avatar', 'premium']


class UserDetailSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(required=False)
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'profile']
        read_only_fields = ['id']

    def update(self, instance, validated_data):
        profile_data = validated_data.pop('profile', None)
        # Update basic User fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        # Update or create profile
        if profile_data is not None:
            profile, created = Profile.objects.get_or_create(user=instance)
            for k, v in profile_data.items():
                setattr(profile, k, v)
            profile.save()
        return instance

class BudgetSerializer(serializers.ModelSerializer):
    remaining = serializers.SerializerMethodField()
    amount = serializers.FloatField()
    spent = serializers.FloatField()

    class Meta:
        model = Budget
        fields = ['id', 'user', 'name', 'amount', 'spent', 'remaining', 'created_at']
        read_only_fields = ['id', 'remaining', 'created_at']

    def get_remaining(self, obj):
        return float(obj.remaining())

class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'user', 'title', 'transaction_type', 'amount', 'category', 'description', 'date', 'budget', 'created_at']
        read_only_fields = ['id', 'created_at']

class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'user', 'name', 'description', 'created_at']
        read_only_fields = ['id', 'created_at']

class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = ['id', 'user', 'name', 'account_type', 'balance', 'created_at']
        read_only_fields = ['id', 'created_at']

class GoalSerializer(serializers.ModelSerializer):
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Goal
        fields = ['id', 'user', 'name', 'target_amount', 'current_amount', 'target_date', 'progress', 'created_at']
        read_only_fields = ['id', 'progress', 'created_at']

    def get_progress(self, obj):
        try:
            return obj.progress_percent()
        except Exception:
            return 0
